-- Consumer-first deployment required. Historical bookings/messages are not
-- reconstructed or resent. Only the two new customer mutation gateways publish.
CREATE UNIQUE INDEX customer_booking_transition_delivery_identity ON public.webhook_retry_queue (
  (payload->'snapshot'->>'bookingId'), (payload->'snapshot'->>'bookingRevision'),
  (payload->>'kind'), (payload->>'role'), target_id
) WHERE payload->'customer_booking_transition_version'='1'::jsonb;

CREATE FUNCTION public.publish_customer_booking_transition_email(p_booking_id uuid,p_kind text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; menu_name text;
  snapshot jsonb; policy jsonb; recipient record; operation_id uuid; queued integer:=0; affected integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('cancelled','rescheduled')
    OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_CAPABILITY_UNAVAILABLE'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND OR (p_kind='cancelled' AND b.status<>'cancelled')
    OR (p_kind='rescheduled' AND b.status NOT IN ('pending','confirmed')) THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_STATE_MISMATCH';
  END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_FACILITY_UNAVAILABLE'; END IF;
  SELECT m.name INTO menu_name FROM public.facility_menus m WHERE m.id=b.menu_id AND m.facility_id=b.facility_id;
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'customerName',b.customer_name,'customerEmail',coalesce(b.email,''),'facilityName',f.name,
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',menu_name,
    'totalPrice',b.total_price,'capturedAt',clock_timestamp(),'cancelPolicy',policy);
  -- SQL scans the complete recipient set; shared owner addresses are deduplicated.
  -- A customer who also owns the shop receives the two distinct existing templates.
  FOR recipient IN
    SELECT 'customer'::text AS role,b.email AS email WHERE nullif(btrim(b.email),'') IS NOT NULL
    UNION ALL
    SELECT DISTINCT 'owner'::text,p.email FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE p_kind='cancelled' AND m.facility_id=b.facility_id AND m.role IN ('owner','admin')
        AND nullif(btrim(p.email),'') IS NOT NULL
  LOOP
    operation_id:=gen_random_uuid();
    INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
      VALUES(operation_id,'email',recipient.email,b.facility_id,jsonb_build_object(
        'event_email_version',1,'dispatch_version',2,'idempotency_key','carelink-event-email/'||operation_id::text,
        'customer_booking_transition_version',1,'kind',p_kind,'role',recipient.role,'snapshot',snapshot),'pending',now())
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; queued:=queued+affected;
  END LOOP;
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.publish_customer_booking_transition_email(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_customer_booking_transition_email(uuid,text) TO service_role;

CREATE FUNCTION public.cancel_customer_booking_with_outbox_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.cancel_booking_with_points_atomic(p_actor_id,p_booking_id,p_expected_status);
  PERFORM public.publish_customer_booking_transition_email(p_booking_id,'cancelled');
  RETURN QUERY SELECT p_booking_id;
END $$;
REVOKE ALL ON FUNCTION public.cancel_customer_booking_with_outbox_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_booking_with_outbox_atomic(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.change_customer_booking_with_outbox_atomic(p_booking_id uuid,p_user_id uuid,
  p_booking_date date,p_start_time time,p_end_time time,p_enforce_schedule boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_booking public.bookings%ROWTYPE;
BEGIN
  -- Keep the original lock order: actor account, date capacity/readiness, booking.
  PERFORM public.lock_booking_account(p_user_id);
  SELECT * INTO old_booking FROM public.bookings WHERE bookings.id=p_booking_id;
  -- A replay with the same target time has no new transition or notification.
  -- Still validate ownership/state. No-op does not change updated_at or supersede an existing job.
  IF FOUND AND old_booking.user_id=p_user_id AND old_booking.status IN ('pending','confirmed')
    AND old_booking.booking_date=p_booking_date AND old_booking.start_time=p_start_time
    AND old_booking.end_time=p_end_time THEN RETURN; END IF;
  PERFORM public.change_booking_atomic(p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,p_enforce_schedule);
  -- NOW() in the historical primitive is transaction-wide. Distinct transitions
  -- in one transaction must not share a delivery identity.
  UPDATE public.bookings SET updated_at=clock_timestamp() WHERE bookings.id=p_booking_id;
  PERFORM public.publish_customer_booking_transition_email(p_booking_id,'rescheduled');
END $$;
REVOKE ALL ON FUNCTION public.change_customer_booking_with_outbox_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_booking_with_outbox_atomic(uuid,uuid,date,time,time,boolean) TO service_role;

CREATE FUNCTION public.start_customer_booking_transition_email(p_queue_id uuid,p_claimed_at timestamptz)
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
    OR coalesce(b.updated_at,b.created_at) IS DISTINCT FROM (q.payload->'snapshot'->>'bookingRevision')::timestamptz
    OR (q.payload->>'kind'='cancelled' AND b.status<>'cancelled')
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
