-- A referral code can be entered only before the customer's first completed
-- visit (apply_referral_code_atomic refuses with REFERRAL_NOT_ELIGIBLE).
--
-- Rule: the bonus is earned by the referred customer's first completed visit
-- (award_referral_points_atomic runs when a booking is completed; /mypage/referral
-- says 「初回のご予約完了で」, and /api/referral was written for new customers).
--
-- Before: the code was accepted from a customer who had already completed a
-- visit and the page answered 「初回のご予約完了で300ポイントが付与されます」.
-- That first completion had already happened, so nothing was granted until a
-- later visit, and never if the customer did not come back.
-- After: such a customer is refused with REFERRAL_NOT_ELIGIBLE and no
-- referral_uses row or used_count increment is written. The check runs after
-- the replay check (an existing application of the same code still answers as
-- before) and under the customer's points lock, which every completion path
-- (complete / checkout / status change) also takes, so a completion cannot slip
-- between the check and the insert.
-- Only this function body changes: same signature, SECURITY INVOKER,
-- search_path and grants (re-stated). The rest of the body is copied verbatim
-- from 20261009005739_referral_apply_atomic.sql, the latest definition (no later
-- migration or DO-block patch).
--
-- Order: apply AFTER the application deploy that maps REFERRAL_NOT_ELIGIBLE
-- (/api/referral answers 400 「紹介コードは初回のご来店前の方のみご利用いただけます。」).
-- The current application has no message for the new code and would answer
-- such a request with a generic 500 and a Slack alert. Until this migration is
-- applied, the new application behaves as before for these customers.
-- No data rewrite (production has no referral_uses rows).
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.apply_referral_code_atomic(p_user_id uuid,p_code text)
RETURNS TABLE(use_id uuid,code text,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_id uuid; c public.referral_codes%ROWTYPE; u public.referral_uses%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL OR length(p_code) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  SELECT r.user_id INTO owner_id FROM public.referral_codes r WHERE r.code=upper(p_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  PERFORM public.lock_booking_point_actors(p_user_id,owner_id);
  SELECT r.* INTO c FROM public.referral_codes r WHERE r.code=upper(p_code) FOR UPDATE;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  IF c.user_id=p_user_id THEN RAISE EXCEPTION 'REFERRAL_SELF_USE'; END IF;
  SELECT r.* INTO u FROM public.referral_uses r WHERE r.referred_user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    IF u.code IS DISTINCT FROM c.code OR u.referrer_user_id IS DISTINCT FROM c.user_id
      THEN RAISE EXCEPTION 'REFERRAL_ALREADY_APPLIED'; END IF;
    RETURN QUERY SELECT u.id,u.code,true; RETURN;
  END IF;
  -- The first completed visit has already happened: the bonus can no longer be earned.
  IF EXISTS(SELECT 1 FROM public.bookings b WHERE b.user_id=p_user_id AND b.status='completed')
    THEN RAISE EXCEPTION 'REFERRAL_NOT_ELIGIBLE'; END IF;
  INSERT INTO public.referral_uses(code,referred_user_id,referrer_user_id)
    VALUES(c.code,p_user_id,c.user_id) RETURNING * INTO u;
  RETURN QUERY SELECT u.id,u.code,false;
END $$;
REVOKE ALL ON FUNCTION public.apply_referral_code_atomic(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_code_atomic(uuid,text) TO service_role;
