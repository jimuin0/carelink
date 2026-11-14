-- B9-4: 予約のキャンセル通知が、キャンセル後に updated_at が動くと送られない不具合を直す。
--
-- 以前は送信直前の検査（start_customer_booking_transition_email / start_booking_email_event）が
-- 予約の updated_at とキュー作成時の revision の完全一致を要求していた。キャンセル後にメモ編集や
-- トリガで updated_at が動くと、キャンセル通知は superseded として捨てられ、客にも店にも届かなかった。
--
-- 'cancelled' は終端状態（どの経路でもキャンセルから戻る遷移は無い）なので、キャンセル通知は
-- 「予約が今もキャンセル状態か」で判定する。revision の完全一致は、内容が意味を持つ通知
-- （日時変更 rescheduled・確認・完了など）にだけ残す。
--   start_customer_booking_transition_email … 写し元 20261013082022（kind='cancelled' だけ revision 不問）
--   save_booking_email_event_atomic         … 写し元 20261023020100（payload に new_status を記録するだけ）
--   start_booking_email_event               … 写し元 20261002012217（new_status='cancelled' の status 通知だけ revision 不問。
--                                               new_status を持たない既存行は従来どおり完全一致）
-- いずれも最新定義の全文を写して CREATE OR REPLACE する（pg_get_functiondef + replace は使わない）。
-- 権限は写し元と同じ（service_role のみ）。データの書き換えは無い。
--
-- 適用順：コード配信と独立（アプリは関数の戻り値・引数を変えずに呼ぶだけ）。いつ適用してもよい。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.start_customer_booking_transition_email(p_queue_id uuid,p_claimed_at timestamptz)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE; b public.bookings%ROWTYPE; bid uuid; fid uuid; stamp timestamptz;
BEGIN
  SELECT (payload->'snapshot'->>'bookingId')::uuid,facility_id INTO bid,fid
    FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id;
  -- Match mutation/publication ordering; a deletion cannot remove the parent while fenced.
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=bid FOR SHARE;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at
    OR q.delivery_started_at IS NOT NULL THEN RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN; END IF;
  IF q.webhook_type<>'email' OR q.payload->'customer_booking_transition_version' IS DISTINCT FROM '1'::jsonb
    OR q.email_envelope IS NULL OR q.email_envelope->>'to' IS DISTINCT FROM q.target_id THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_FENCE_INVALID';
  END IF;
  IF b.id IS NULL OR b.facility_id IS DISTINCT FROM q.facility_id
    -- B9-4: a cancellation stays deliverable while the booking is still cancelled ('cancelled' is terminal),
    -- even if a later note edit or trigger moved updated_at. Only a change notice depends on the exact revision.
    OR (q.payload->>'kind'='cancelled' AND b.status<>'cancelled')
    OR (q.payload->>'kind' IS DISTINCT FROM 'cancelled'
      AND coalesce(b.updated_at,b.created_at) IS DISTINCT FROM (q.payload->'snapshot'->>'bookingRevision')::timestamptz)
    OR (q.payload->>'kind'='rescheduled' AND b.status NOT IN ('pending','confirmed'))
    OR (q.payload->>'role'='owner' AND NOT EXISTS(SELECT 1 FROM public.facility_members m
      JOIN public.profiles p ON p.id=m.user_id WHERE m.facility_id=b.facility_id AND m.role IN ('owner','admin') AND p.email=q.target_id)) THEN
    UPDATE public.webhook_retry_queue SET status='failed',processed_at=clock_timestamp(),last_error='customer_booking_transition_superseded'
      WHERE webhook_retry_queue.id=q.id;
    RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
  END IF;
  stamp:=clock_timestamp();
  UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE webhook_retry_queue.id=q.id;
  RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_customer_booking_transition_email(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_customer_booking_transition_email(uuid,timestamptz) TO service_role;

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
    'idempotency_key','carelink-event-email/' || op::text,'new_status',p_new_status),p_envelope,'pending',0,3,clock_timestamp(),b.id,rev,kind);
  IF kind = 'adjust' THEN INSERT INTO public.booking_adjust_operations(operation_id,actor_id,booking_id,queue_id)
    VALUES(p_operation_id,p_actor_id,b.id,op); END IF;
  RETURN QUERY SELECT op, false, 'queued'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.start_booking_email_event(p_queue_id uuid, p_claimed_at timestamptz)
RETURNS TABLE(outcome text, started_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE bid uuid; b public.bookings%ROWTYPE; q public.webhook_retry_queue%ROWTYPE; stamp timestamptz;
BEGIN
  SELECT booking_event_id INTO bid FROM public.webhook_retry_queue WHERE id = p_queue_id;
  IF bid IS NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EVENT'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = bid FOR SHARE;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.status <> 'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at
    OR q.delivery_started_at IS NOT NULL THEN
    RETURN QUERY SELECT 'not_owned'::text, NULL::timestamptz; RETURN;
  END IF;
  -- B9-4: a status event that cancelled the booking (new_status recorded since 20261113130000) stays
  -- deliverable while the booking is still cancelled. Rows queued before that have no new_status and
  -- keep the exact-revision rule.
  IF b.id IS NULL
    OR (q.booking_event_kind = 'status' AND q.payload->>'new_status' IS NOT DISTINCT FROM 'cancelled' AND b.status <> 'cancelled')
    OR (NOT (q.booking_event_kind = 'status' AND q.payload->>'new_status' IS NOT DISTINCT FROM 'cancelled')
      AND coalesce(b.updated_at,b.created_at) IS DISTINCT FROM q.booking_event_revision)
    OR (q.booking_event_kind = 'adjust' AND b.status NOT IN ('pending','confirmed')) THEN
    UPDATE public.webhook_retry_queue SET status='cancelled', processed_at=clock_timestamp(),
      last_error='booking_event_superseded' WHERE id=q.id;
    RETURN QUERY SELECT 'superseded'::text, NULL::timestamptz; RETURN;
  END IF;
  stamp := clock_timestamp();
  UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE id=q.id;
  RETURN QUERY SELECT 'ready'::text, stamp;
END;
$$;
REVOKE ALL ON FUNCTION public.start_booking_email_event(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_booking_email_event(uuid,timestamptz) TO service_role;
