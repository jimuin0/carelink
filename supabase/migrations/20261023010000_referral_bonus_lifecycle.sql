-- Referral bonus lifecycle: a deleted referrer no longer blocks the referred
-- customer's bonus, and a reversed first visit reverses the bonus.
--
-- 1. Deleted referrer (award_referral_points_atomic).
--    Before: referral_uses.referrer_user_id has no FK, so the row survives the
--    referrer's account deletion. award_referral_points_atomic then locked the
--    deleted account with lock_booking_account, which raises
--    BOOKING_ACCOUNT_UNAVAILABLE. The whole bonus rolled back: the referred
--    customer never received the promised 300pt and each of their later
--    completions raised the same [referral-award-points] Slack alert, forever.
--    After: the referrer is locked only when the account still exists
--    (lock_booking_account_if_present). The referred customer's 300pt is
--    granted; the referrer's 500pt is skipped (user_points.user_id references
--    auth.users, and the referrer's ledger was erased with the account).
--    points_awarded becomes true, so the bonus is settled and the alert stops.
--    A missing referred customer still raises, as before.
--
-- 2. Reversed first visit (sync_booking_points).
--    Before: correcting a completed visit to 無断キャンセル reversed the visit
--    points (来店ポイント取消) but kept 紹介ボーナス 500pt + 紹介コード利用ボーナス
--    300pt, which award_referral_points_atomic grants on the referred
--    customer's first completed visit. Both stayed spendable.
--    After: in the same transaction as the status change, when a booking leaves
--    'completed' and its customer has no completed booking left, both bonuses
--    are compensated with negative rows (history kept, like 来店ポイント取消)
--    and points_awarded returns to false. A later genuine completion grants
--    them again through the unchanged completion paths. While another completed
--    visit remains, the bonus stays: it is still backed by a real visit.
--    As for 来店ポイント取消, the balance is not checked: a bonus already spent
--    leaves a negative balance, which blocks further point use.
--    The compensation writes to the referrer's ledger. lock_booking_point_actors
--    therefore also takes the customer's referrer, in the same sorted pass as
--    the actor and the customer, so the trigger never takes a points lock out
--    of order. A deleted referrer is skipped there too.
--
-- Order: safe to apply before the application deploy. Same signatures, owners,
-- security modes, search_path and grants (re-stated below). The application
-- calls award_referral_points_atomic exactly as before, and
-- save_booking_email_event_atomic (completed -> no_show) reaches the reversal
-- through the existing booking_points_atomic trigger. No data rewrite
-- (production has no referral_uses rows).
-- Latest definitions replaced here (no later migration or DO-block patch):
-- lock_booking_point_actors, sync_booking_points and award_referral_points_atomic
-- from 20261008080209_atomic_booking_points.sql.
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- Same lock as lock_booking_account, but an account that no longer exists is
-- reported instead of raised. Only for accounts whose absence is a valid state
-- (the referrer of a referral_uses row).
CREATE OR REPLACE FUNCTION public.lock_booking_account_if_present(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-points:'||p_user_id::text,0));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.lock_booking_account_if_present(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_account_if_present(uuid) TO service_role;

-- Lock cross-user actors deterministically before any facility/membership rows.
-- The customer's referrer is included: a booking leaving 'completed' may write
-- the referral bonus compensation to that account (sync_booking_points).
CREATE OR REPLACE FUNCTION public.lock_booking_point_actors(p_actor_id uuid,p_customer_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE uid uuid; ref uuid; BEGIN
 SELECT u.referrer_user_id INTO ref FROM public.referral_uses u WHERE u.referred_user_id=p_customer_id;
 FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id,p_customer_id,ref]) x WHERE x IS NOT NULL ORDER BY x LOOP
  IF uid IS NOT DISTINCT FROM p_actor_id OR uid IS NOT DISTINCT FROM p_customer_id THEN
   PERFORM public.lock_booking_account(uid);
  ELSE
   PERFORM public.lock_booking_account_if_present(uid);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.lock_booking_point_actors(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_point_actors(uuid,uuid) TO service_role;

-- Preserve the existing completion bonus; its CAS flag and the credits commit
-- together. A failed insert leaves points_awarded=false, so recovery is safe.
-- A referrer whose account was deleted is skipped; the referred customer is not.
CREATE OR REPLACE FUNCTION public.award_referral_points_atomic(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ref uuid; uid uuid; r public.referral_uses%ROWTYPE; referrer_present boolean:=false;
BEGIN
  SELECT referrer_user_id INTO ref FROM public.referral_uses WHERE referred_user_id=p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_user_id,ref]) x ORDER BY x LOOP
    IF uid=p_user_id THEN PERFORM public.lock_booking_account(uid);
    ELSE referrer_present:=public.lock_booking_account_if_present(uid); END IF;
  END LOOP;
  SELECT * INTO r FROM public.referral_uses WHERE referred_user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR r.points_awarded THEN RETURN false; END IF;
  IF r.referrer_user_id IS DISTINCT FROM ref THEN RAISE EXCEPTION 'REFERRAL_REVISION_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE user_id=p_user_id AND status='completed') THEN RETURN false; END IF;
  IF referrer_present THEN
    INSERT INTO public.user_points(user_id,points,reason) VALUES(ref,500,'紹介ボーナス');
  END IF;
  INSERT INTO public.user_points(user_id,points,reason) VALUES(p_user_id,300,'紹介コード利用ボーナス');
  UPDATE public.referral_uses SET points_awarded=true WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.award_referral_points_atomic(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_points_atomic(uuid) TO service_role;

-- The bonus is earned by the referred customer's first completed visit. Once no
-- completed visit is left, compensate both credits and reopen the claim.
-- Only sync_booking_points calls this, after it locked p_user_id; the caller's
-- lock_booking_point_actors already took the referrer in sorted order.
CREATE OR REPLACE FUNCTION public.reverse_referral_points_without_visit(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.referral_uses%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.referral_uses WHERE referred_user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR r.points_awarded IS NOT TRUE THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.bookings WHERE user_id=p_user_id AND status='completed') THEN RETURN false; END IF;
  IF public.lock_booking_account_if_present(r.referrer_user_id) THEN
    INSERT INTO public.user_points(user_id,points,reason) VALUES(r.referrer_user_id,-500,'紹介ボーナス取消');
  END IF;
  INSERT INTO public.user_points(user_id,points,reason) VALUES(p_user_id,-300,'紹介コード利用ボーナス取消');
  UPDATE public.referral_uses SET points_awarded=false WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reverse_referral_points_without_visit(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sync_booking_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE balance bigint; earned int; awarded int; debit int;
BEGIN
  IF coalesce(NEW.points_used,0)<0 THEN RAISE EXCEPTION 'INVALID_BOOKING_POINTS'; END IF;
  IF NEW.user_id IS NULL THEN
    IF coalesce(NEW.points_used,0)>0 THEN RAISE EXCEPTION 'POINTS_AUTH_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
  PERFORM public.lock_booking_account(NEW.user_id);
  IF TG_OP='INSERT' AND coalesce(NEW.points_used,0)>0 THEN
    SELECT coalesce(sum(points),0) INTO balance FROM public.user_points WHERE user_id=NEW.user_id;
    IF balance<NEW.points_used THEN RAISE EXCEPTION 'POINTS_INSUFFICIENT'; END IF;
    INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
      VALUES(NEW.user_id,-NEW.points_used,'予約利用 ('||left(NEW.id::text,8)||')',NEW.id,'debit');
  END IF;
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    earned:=floor(greatest(coalesce(NEW.total_price,0),0)/100.0)::int;
    IF earned>0 THEN
      -- Unclassified legacy booking rows require reconciliation, not guesswork.
      IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
        THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,earned,'来店ポイント',NEW.id,'award');
    END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    SELECT points INTO awarded FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='award';
    IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF coalesce(awarded,0)>0 THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,-awarded,'来店ポイント取消',NEW.id,'reversal');
    END IF;
    -- The referral bonus follows the first completed visit it was granted for.
    PERFORM public.reverse_referral_points_without_visit(NEW.user_id);
  END IF;
  IF NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'cancelled')
    AND coalesce(NEW.points_used,0)>0 THEN
    SELECT -points INTO debit FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='debit';
    IF debit IS DISTINCT FROM NEW.points_used
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    -- An exact historical refund is already fulfilled; never credit it twice.
    IF NOT EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation='refund') THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,NEW.points_used,'キャンセル返還',NEW.id,'refund');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_booking_points() FROM PUBLIC,anon,authenticated,service_role;
