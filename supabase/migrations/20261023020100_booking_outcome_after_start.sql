-- A visit outcome (完了 / 無断キャンセル) can only be recorded once the booking has
-- started (JST).
--
-- Before, a shop could set a future booking to completed (one tap, no confirmation)
-- or no_show, and 「会計する」 completed it too. Completion awards visit points,
-- records a customer visit dated in the future, emails the customer that the
-- treatment is complete, stops the reminder and lets the review request go out
-- before the visit. The only way back from a mistaken completion is no_show,
-- which emails the customer that they did not come.
--
-- Every path that writes these outcomes now refuses with BOOKING_NOT_STARTED while
-- (booking_date + start_time) in Asia/Tokyo is still in the future (the start
-- itself counts as started; the customer cancellation guard BOOKING_ALREADY_STARTED
-- uses the same instant):
--   save_booking_email_event_atomic       (/api/admin/booking-status: completed, no_show)
--   checkout_booking_with_points_atomic   (/api/admin/booking-checkout with complete=true)
--   complete_booking_with_points_atomic   (/api/booking/complete)
-- Replays of an already saved completion, checkout without completion, 受付
-- (arrived) and cancellations are unchanged. No data rewrite (production has 0
-- future bookings).
--
-- Safe before the application deploy: the deployed application already refuses
-- invalid transitions; until the new application (which refuses before calling
-- and maps BOOKING_NOT_STARTED to a 400 with a Japanese message) is deployed, an
-- early completion fails with the generic 500 message instead of being saved.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- Authoritative body: 20261008080209 + the start-time guard.
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
  -- A visit outcome is recorded only once the booking has started (JST).
  IF kind = 'status' AND p_new_status IN ('completed','no_show')
    AND (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo'>clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_NOT_STARTED'; END IF;
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

-- Authoritative body: 20261008080209 + the start-time guard for p_complete.
CREATE OR REPLACE FUNCTION public.checkout_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text,
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
  -- Completing through checkout is a visit outcome: only once the booking has started (JST).
  IF p_complete AND (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo'>clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_NOT_STARTED'; END IF;
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
REVOKE ALL ON FUNCTION public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean) TO service_role;

-- Authoritative body: 20261023000100_booking_visit_points_cap.sql (the visit-points cap
-- replay check via booking_visit_points_due) + the start-time guard (replays unchanged).
CREATE OR REPLACE FUNCTION public.complete_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
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
      IS DISTINCT FROM public.booking_visit_points_due(b.user_id,b.facility_id,b.total_price,b.points_base_price)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.customer_visits v WHERE v.booking_id=b.id AND v.facility_id=b.facility_id
      AND v.amount IS NOT DISTINCT FROM b.total_price) THEN RAISE EXCEPTION 'BOOKING_VISIT_RECONCILIATION_REQUIRED'; END IF;
    RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='award'),0),true;
    RETURN;
  END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.status<>'confirmed' THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  -- A visit outcome is recorded only once the booking has started (JST).
  IF (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo'>clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_NOT_STARTED'; END IF;
  UPDATE public.bookings SET status='completed',updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id
    AND p.booking_operation='award'),0),false;
END $$;
REVOKE ALL ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) TO service_role;
