-- Point money movements commit with the booking/visit state; preserve legacy history.
ALTER TABLE public.user_points ADD COLUMN booking_operation text;
ALTER TABLE public.user_points ADD CONSTRAINT user_points_booking_operation_check
  CHECK (booking_operation IS NULL OR booking_operation IN ('debit','refund','award','reversal'));
-- Install both protections before linking old debits to bookings that may
-- already carry an award/refund. The former one-row-per-booking index would
-- reject that valid second typed movement during the cutover itself.
CREATE UNIQUE INDEX user_points_booking_operation_unique
  ON public.user_points(booking_id,booking_operation) WHERE booking_id IS NOT NULL AND booking_operation IS NOT NULL;
CREATE UNIQUE INDEX user_points_legacy_booking_unique
  ON public.user_points(booking_id) WHERE booking_id IS NOT NULL AND booking_operation IS NULL;
DROP INDEX public.idx_user_points_booking_id_unique;
-- Classify only existing rows whose booking, user, reason and amount agree exactly.
UPDATE public.user_points p SET booking_operation = CASE
  WHEN p.reason='来店ポイント' AND p.points=floor(greatest(coalesce(b.total_price,0),0)/100.0)::int THEN 'award'
  WHEN p.reason='キャンセル返還' AND p.points=b.points_used AND b.points_used>0 THEN 'refund' END
FROM public.bookings b WHERE p.booking_id=b.id AND p.user_id=b.user_id
  AND ((p.reason='来店ポイント' AND p.points=floor(greatest(coalesce(b.total_price,0),0)/100.0)::int)
    OR (p.reason='キャンセル返還' AND p.points=b.points_used AND b.points_used>0));
-- The old API omitted booking_id on debits. Link only one-to-one exact matches;
-- ambiguous/missing records remain untouched and are reported by the audit RPC.
WITH candidates AS (
  SELECT p.id point_id,b.id booking_id,
    count(*) OVER(PARTITION BY p.id) pc,count(*) OVER(PARTITION BY b.id) bc
  FROM public.user_points p JOIN public.bookings b ON b.user_id=p.user_id
    AND p.points=-b.points_used AND b.points_used>0
    AND p.reason='予約利用 ('||left(b.id::text,8)||')'
  WHERE p.booking_id IS NULL AND p.booking_operation IS NULL
)
UPDATE public.user_points p SET booking_id=c.booking_id,booking_operation='debit'
FROM candidates c WHERE c.pc=1 AND c.bc=1 AND p.id=c.point_id;

CREATE OR REPLACE FUNCTION public.lock_booking_account(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ACCOUNT_UNAVAILABLE'; END IF;
  -- This exists even when the ledger is empty; locking current rows cannot do that.
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-points:'||p_user_id::text,0));
END $$;
REVOKE ALL ON FUNCTION public.lock_booking_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_account(uuid) TO service_role;

-- Lock cross-user actors deterministically before any facility/membership rows.
CREATE FUNCTION public.lock_booking_point_actors(p_actor_id uuid,p_customer_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE uid uuid; BEGIN
 FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id,p_customer_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM public.lock_booking_account(uid);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.lock_booking_point_actors(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_point_actors(uuid,uuid) TO service_role;

CREATE FUNCTION public.guard_user_point_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE matches int;
BEGIN
  IF TG_OP='DELETE' THEN
    -- Account erasure cascades must retain their existing semantics. Ordinary
    -- application compensation cannot delete typed money movements.
    IF OLD.booking_operation IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id)
      THEN RETURN NULL; END IF;
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN PERFORM public.lock_booking_account(OLD.user_id); END IF; RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.booking_operation IS NOT NULL AND
    (OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.points IS DISTINCT FROM NEW.points
      OR OLD.reason IS DISTINCT FROM NEW.reason OR OLD.booking_operation IS DISTINCT FROM NEW.booking_operation
      OR (OLD.booking_id IS DISTINCT FROM NEW.booking_id AND NEW.booking_id IS NOT NULL))
    THEN RAISE EXCEPTION 'POINTS_LEDGER_IMMUTABLE'; END IF;
  PERFORM public.lock_booking_account(NEW.user_id);
  -- DB-first rollout compatibility. Old servers perform a second insert after
  -- the booking committed. Preserve their single-row acknowledgement with a
  -- transparent zero-value receipt, rather than spending/crediting twice.
  IF TG_OP='INSERT' AND NEW.booking_operation IS NULL THEN
    IF NEW.booking_id IS NULL AND NEW.points<0 AND NEW.reason~'^予約利用 \([0-9a-f]{8}\)$' THEN
      SELECT count(*) INTO matches FROM public.user_points p JOIN public.bookings b ON b.id=p.booking_id
        WHERE p.user_id=NEW.user_id AND p.points=NEW.points AND p.booking_operation='debit'
          AND NEW.reason='予約利用 ('||left(b.id::text,8)||')';
      IF matches>1 THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
      IF matches=1 THEN NEW.points:=0; NEW.reason:='互換受領（控除済み） '||NEW.reason;
      ELSIF EXISTS(SELECT 1 FROM public.user_points p JOIN public.bookings b ON b.id=p.booking_id
        WHERE p.user_id=NEW.user_id AND p.booking_operation='debit' AND NEW.reason='予約利用 ('||left(b.id::text,8)||')')
        THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    ELSIF NEW.booking_id IS NOT NULL AND NEW.reason IN ('来店ポイント','キャンセル返還') THEN
      IF EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=NEW.booking_id
        AND p.user_id=NEW.user_id AND p.points=NEW.points
        AND p.booking_operation=CASE WHEN NEW.reason='来店ポイント' THEN 'award' ELSE 'refund' END) THEN
        NEW.points:=0; NEW.booking_id:=NULL; NEW.reason:='互換受領（付与済み） '||NEW.reason;
      ELSIF EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=NEW.booking_id
        AND p.booking_operation=CASE WHEN NEW.reason='来店ポイント' THEN 'award' ELSE 'refund' END)
        THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_user_point_ledger() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER user_points_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.user_points
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_point_ledger();

CREATE FUNCTION public.sync_booking_points() RETURNS trigger
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
CREATE TRIGGER booking_points_atomic AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_points();

-- The historical create RPC retains its name. New callers must not spend
-- points against an old DB where its booking has no transactional debit.
-- Catalog-only capability; no Auth schema privilege or mutation is exposed.
CREATE FUNCTION public.booking_points_atomic_version() RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.bookings'::regclass AND t.tgname='booking_points_atomic'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgtype=21
      AND t.tgfoid='public.sync_booking_points()'::regprocedure
      AND t.tgattr::text=(SELECT a.attnum::text FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public.bookings'::regclass AND a.attname='status' AND NOT a.attisdropped))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public.user_points'::regclass AND t.tgname='user_points_serialize'
        AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgtype=31
        AND t.tgfoid='public.guard_user_point_ledger()'::regprocedure)
  THEN 1 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.booking_points_atomic_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_points_atomic_version() TO service_role;

CREATE FUNCTION public.booking_point_legacy_issues()
RETURNS TABLE(booking_id uuid,issue text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT b.id,'missing_or_ambiguous_debit'::text FROM public.bookings b
  WHERE b.points_used>0 AND NOT EXISTS(SELECT 1 FROM public.user_points p
    WHERE p.booking_id=b.id AND p.user_id=b.user_id AND p.booking_operation='debit' AND p.points=-b.points_used)
  UNION ALL
  SELECT p.booking_id,'unclassified_booking_entry' FROM public.user_points p
    WHERE p.booking_id IS NOT NULL AND p.booking_operation IS NULL
  UNION ALL
  SELECT b.id,'missing_or_mismatched_completion_award' FROM public.bookings b
    WHERE b.user_id IS NOT NULL AND b.status='completed' AND coalesce(b.total_price,0)>=100
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.user_id=b.user_id
        AND p.booking_operation='award' AND p.points=floor(b.total_price/100.0)::int)
  UNION ALL
  SELECT b.id,'missing_refund' FROM public.bookings b
    WHERE b.user_id IS NOT NULL AND b.status='cancelled' AND b.points_used>0
      AND EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='debit' AND p.points=-b.points_used)
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='refund' AND p.points=b.points_used)
  UNION ALL
  SELECT b.id,'missing_completion_reversal' FROM public.bookings b JOIN public.user_points a
    ON a.booking_id=b.id AND a.booking_operation='award'
    WHERE b.status<>'completed' AND NOT EXISTS(SELECT 1 FROM public.user_points r
      WHERE r.booking_id=b.id AND r.booking_operation='reversal' AND r.points=-a.points);
$$;
REVOKE ALL ON FUNCTION public.booking_point_legacy_issues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_point_legacy_issues() TO service_role;

CREATE FUNCTION public.complete_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid,points_earned int,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; uid uuid; fid uuid;
BEGIN
  SELECT user_id,facility_id INTO uid,fid FROM public.bookings WHERE bookings.id=p_booking_id;
  PERFORM public.lock_booking_point_actors(p_actor_id,uid);
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  PERFORM 1 FROM public.facility_members WHERE facility_id=fid AND user_id=p_actor_id
    AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id AND facility_id=fid FOR UPDATE;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF b.status='completed' AND p_expected_status='confirmed' THEN
    IF coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='award'),0)
      IS DISTINCT FROM (CASE WHEN b.user_id IS NULL THEN 0 ELSE floor(greatest(coalesce(b.total_price,0),0)/100.0)::int END)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.customer_visits v WHERE v.booking_id=b.id AND v.facility_id=b.facility_id
      AND v.amount IS NOT DISTINCT FROM b.total_price) THEN RAISE EXCEPTION 'BOOKING_VISIT_RECONCILIATION_REQUIRED'; END IF;
    RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='award'),0),true;
    RETURN;
  END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.status<>'confirmed' THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  UPDATE public.bookings SET status='completed',updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id
    AND p.booking_operation='award'),0),false;
END $$;

CREATE FUNCTION public.cancel_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; fid uuid;
BEGIN
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT facility_id INTO fid FROM public.bookings WHERE bookings.id=p_booking_id AND user_id=p_actor_id;
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id AND user_id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.status NOT IN ('pending','confirmed','arrived')
    THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  IF (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo'<clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_ALREADY_STARTED'; END IF;
  UPDATE public.bookings SET status='cancelled',updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id;
END $$;

CREATE FUNCTION public.checkout_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text,
  p_expected_updated_at timestamptz,p_charges jsonb,p_paid_amount int,p_complete boolean)
RETURNS TABLE(id uuid,total_price int,points_earned int) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; uid uuid; fid uuid; total bigint; item jsonb;
BEGIN
  SELECT user_id,facility_id INTO uid,fid FROM public.bookings WHERE bookings.id=p_booking_id;
  PERFORM public.lock_booking_point_actors(p_actor_id,uid);
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  PERFORM 1 FROM public.facility_members WHERE facility_id=fid AND user_id=p_actor_id
    AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id AND facility_id=fid FOR UPDATE;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.updated_at IS DISTINCT FROM p_expected_updated_at
    OR b.status NOT IN ('confirmed','arrived') THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  IF jsonb_typeof(p_charges) IS DISTINCT FROM 'array' OR jsonb_array_length(p_charges) NOT BETWEEN 1 AND 50
    THEN RAISE EXCEPTION 'INVALID_BOOKING_CHARGES'; END IF;
  total:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_charges) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'type') IS DISTINCT FROM 'string' OR item->>'type' NOT IN ('menu','retail','discount')
      OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR nullif(btrim(item->>'name'),'') IS NULL OR length(item->>'name')>100
      OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'number' OR (item->>'amount')!~'^-?[0-9]+$'
      OR abs((item->>'amount')::bigint)>100000000 THEN RAISE EXCEPTION 'INVALID_BOOKING_CHARGES'; END IF;
    total:=total+(item->>'amount')::bigint;
  END LOOP;
  total:=greatest(total,0);
  IF total>2147483647 OR p_paid_amount<0 OR p_paid_amount>100000000 OR p_complete IS NULL
    THEN RAISE EXCEPTION 'INVALID_BOOKING_CHARGES'; END IF;
  UPDATE public.bookings SET charges=p_charges,total_price=total::int,
    paid_amount=coalesce(p_paid_amount,paid_amount),status=CASE WHEN p_complete THEN 'completed' ELSE b.status END,
    updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id,total::int,coalesce((SELECT p.points FROM public.user_points p
    WHERE p.booking_id=b.id AND p.booking_operation='award'),0);
END $$;
REVOKE ALL ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text),
  public.cancel_booking_with_points_atomic(uuid,uuid,text),
  public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text),
  public.cancel_booking_with_points_atomic(uuid,uuid,text),
  public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.save_booking_email_event_atomic(
  p_actor_id uuid, p_booking_id uuid, p_expected_status text,
  p_expected_updated_at timestamptz, p_new_status text, p_envelope jsonb,
  p_operation_id uuid DEFAULT NULL
) RETURNS TABLE(operation_id uuid, replayed boolean, notification text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; fid uuid; op uuid; rev timestamptz; kind text;
  prior public.booking_adjust_operations%ROWTYPE; point_user uuid;
BEGIN
  kind := CASE WHEN p_new_status IS NULL THEN 'adjust' ELSE 'status' END;
  IF kind = 'adjust' THEN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION_ID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('booking-adjust/' || p_operation_id::text, 0));
  END IF;
  SELECT user_id INTO point_user FROM public.bookings WHERE id=p_booking_id;
  PERFORM public.lock_booking_point_actors(p_actor_id,point_user);
  SELECT facility_id INTO fid FROM public.bookings WHERE id = p_booking_id;
  IF fid IS NULL THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id = fid AND m.user_id = p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id AND facility_id = fid FOR UPDATE;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM point_user THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF kind = 'adjust' THEN
    SELECT a.* INTO prior FROM public.booking_adjust_operations a WHERE a.operation_id = p_operation_id;
    IF FOUND THEN
      IF prior.actor_id IS DISTINCT FROM p_actor_id OR prior.booking_id IS DISTINCT FROM p_booking_id
        THEN RAISE EXCEPTION 'BOOKING_OPERATION_CONFLICT'; END IF;
      RETURN QUERY SELECT prior.queue_id, true, 'already_queued'::text; RETURN;
    END IF;
  END IF;
  IF kind = 'adjust' AND b.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_BOOKING_TRANSITION'; END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  IF kind = 'status' AND NOT (
    (b.status = 'pending' AND p_new_status IN ('confirmed','cancelled')) OR
    (b.status = 'confirmed' AND p_new_status IN ('arrived','completed','cancelled','no_show')) OR
    (b.status = 'arrived' AND p_new_status IN ('completed','cancelled','no_show')) OR
    (b.status = 'completed' AND p_new_status = 'no_show') OR
    (b.status = 'no_show' AND p_new_status = 'cancelled')
  ) THEN RAISE EXCEPTION 'INVALID_BOOKING_TRANSITION'; END IF;
  IF b.email IS NULL OR p_new_status = 'arrived' THEN
    IF kind = 'adjust' THEN RAISE EXCEPTION 'BOOKING_EMAIL_MISSING'; END IF;
    IF p_envelope IS NOT NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EMAIL'; END IF;
  ELSIF p_envelope IS NULL OR p_envelope->>'to' IS DISTINCT FROM b.email
    OR nullif(p_envelope->>'from','') IS NULL OR nullif(p_envelope->>'subject','') IS NULL
    OR nullif(p_envelope->>'html','') IS NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EMAIL'; END IF;
  IF kind = 'status' THEN
    rev := clock_timestamp();
    UPDATE public.bookings SET status = p_new_status, updated_at = rev WHERE id = b.id;
  ELSE rev := coalesce(b.updated_at, b.created_at); END IF;
  IF p_envelope IS NULL THEN RETURN QUERY SELECT NULL::uuid, false, 'not_requested'::text; RETURN; END IF;
  SELECT q.id INTO op FROM public.webhook_retry_queue q WHERE q.booking_event_id = b.id
    AND q.booking_event_revision = rev AND q.booking_event_kind = kind;
  IF op IS NOT NULL THEN
    IF kind = 'adjust' THEN INSERT INTO public.booking_adjust_operations(operation_id,actor_id,booking_id,queue_id)
      VALUES(p_operation_id,p_actor_id,b.id,op); END IF;
    RETURN QUERY SELECT op, true, 'already_queued'::text; RETURN;
  END IF;
  op := gen_random_uuid();
  INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,email_envelope,
    status,attempt_count,max_attempts,scheduled_at,booking_event_id,booking_event_revision,booking_event_kind)
  VALUES(op,'email',b.email,b.facility_id,jsonb_build_object('event_email_version',1,
    'idempotency_key','carelink-event-email/' || op::text),p_envelope,'pending',0,3,clock_timestamp(),b.id,rev,kind);
  IF kind = 'adjust' THEN INSERT INTO public.booking_adjust_operations(operation_id,actor_id,booking_id,queue_id)
    VALUES(p_operation_id,p_actor_id,b.id,op); END IF;
  RETURN QUERY SELECT op, false, 'queued'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) TO service_role;


-- Preserve the existing completion bonus; its CAS flag and BOTH credits commit
-- together. A failed insert leaves points_awarded=false, so recovery is safe.
CREATE FUNCTION public.award_referral_points_atomic(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ref uuid; uid uuid; r public.referral_uses%ROWTYPE;
BEGIN
  SELECT referrer_user_id INTO ref FROM public.referral_uses WHERE referred_user_id=p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_user_id,ref]) x ORDER BY x LOOP
    PERFORM public.lock_booking_account(uid);
  END LOOP;
  SELECT * INTO r FROM public.referral_uses WHERE referred_user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR r.points_awarded THEN RETURN false; END IF;
  IF r.referrer_user_id IS DISTINCT FROM ref THEN RAISE EXCEPTION 'REFERRAL_REVISION_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE user_id=p_user_id AND status='completed') THEN RETURN false; END IF;
  INSERT INTO public.user_points(user_id,points,reason) VALUES(ref,500,'紹介ボーナス'),(p_user_id,300,'紹介コード利用ボーナス');
  UPDATE public.referral_uses SET points_awarded=true WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.award_referral_points_atomic(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_points_atomic(uuid) TO service_role;
