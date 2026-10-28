-- Preserve the existing notification path, adding ending dates only where present.
CREATE OR REPLACE FUNCTION public.publish_customer_booking_transition_email(p_booking_id uuid,p_kind text,
  p_previous_date date,p_previous_start time,p_previous_end time)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; menu_name text;
  snapshot jsonb; policy jsonb; recipient record; operation_id uuid; queued integer:=0; affected integer;
  has_previous boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('cancelled','rescheduled')
    OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_CAPABILITY_UNAVAILABLE'; END IF;
  has_previous:=num_nonnulls(p_previous_date,p_previous_start,p_previous_end)=3;
  IF num_nonnulls(p_previous_date,p_previous_start,p_previous_end) NOT IN (0,3)
    OR (p_kind='cancelled' AND has_previous) THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND OR (p_kind='cancelled' AND b.status<>'cancelled')
    OR (p_kind='rescheduled' AND b.status NOT IN ('pending','confirmed')) THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_STATE_MISMATCH';
  END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_FACILITY_UNAVAILABLE'; END IF;
  SELECT m.name INTO menu_name FROM public.facility_menus m WHERE m.id=b.menu_id AND m.facility_id=b.facility_id;
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate,
      'cancel_rule',p.cancel_rule)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'customerName',b.customer_name,'customerEmail',coalesce(b.email,''),'facilityName',f.name,
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',menu_name,
    'totalPrice',b.total_price,'capturedAt',clock_timestamp(),'cancelPolicy',policy);
  IF b.end_date IS NOT NULL AND b.end_date <> b.booking_date THEN
    snapshot:=snapshot||jsonb_build_object('endDate',b.end_date);
  END IF;
  IF has_previous THEN
    snapshot:=snapshot||jsonb_build_object('previous',jsonb_build_object(
      'bookingDate',p_previous_date,'startTime',p_previous_start,'endTime',p_previous_end));
  END IF;
  -- SQL scans the complete recipient set; shared owner addresses are deduplicated.
  -- A customer who also owns the shop receives the two distinct templates.
  FOR recipient IN
    SELECT 'customer'::text AS role,b.email AS email WHERE nullif(btrim(b.email),'') IS NOT NULL
    UNION ALL
    SELECT DISTINCT 'owner'::text,p.email FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE (p_kind='cancelled' OR has_previous) AND m.facility_id=b.facility_id AND m.role IN ('owner','admin')
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

CREATE OR REPLACE FUNCTION public.publish_customer_booking_transition_email_dated(p_booking_id uuid,p_kind text,
  p_previous_date date,p_previous_start time,p_previous_end time,p_previous_end_date date)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; menu_name text;
  snapshot jsonb; policy jsonb; recipient record; operation_id uuid; queued integer:=0; affected integer;
  has_previous boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('cancelled','rescheduled')
    OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_CAPABILITY_UNAVAILABLE'; END IF;
  has_previous:=num_nonnulls(p_previous_date,p_previous_start,p_previous_end)=3;
  IF num_nonnulls(p_previous_date,p_previous_start,p_previous_end) NOT IN (0,3)
    OR (p_kind='cancelled' AND has_previous) THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND OR (p_kind='cancelled' AND b.status<>'cancelled')
    OR (p_kind='rescheduled' AND b.status NOT IN ('pending','confirmed')) THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_STATE_MISMATCH';
  END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_FACILITY_UNAVAILABLE'; END IF;
  SELECT m.name INTO menu_name FROM public.facility_menus m WHERE m.id=b.menu_id AND m.facility_id=b.facility_id;
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate,
      'cancel_rule',p.cancel_rule)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'customerName',b.customer_name,'customerEmail',coalesce(b.email,''),'facilityName',f.name,
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',menu_name,
    'totalPrice',b.total_price,'capturedAt',clock_timestamp(),'cancelPolicy',policy);
  IF b.end_date IS NOT NULL AND b.end_date <> b.booking_date THEN
    snapshot:=snapshot||jsonb_build_object('endDate',b.end_date);
  END IF;
  IF has_previous THEN
    snapshot:=snapshot||jsonb_build_object('previous',jsonb_build_object(
      'bookingDate',p_previous_date,'startTime',p_previous_start,'endTime',p_previous_end) ||
      CASE WHEN p_previous_end_date IS NOT NULL AND p_previous_end_date <> p_previous_date
        THEN jsonb_build_object('endDate',p_previous_end_date) ELSE '{}'::jsonb END);
  END IF;
  -- SQL scans the complete recipient set; shared owner addresses are deduplicated.
  -- A customer who also owns the shop receives the two distinct templates.
  FOR recipient IN
    SELECT 'customer'::text AS role,b.email AS email WHERE nullif(btrim(b.email),'') IS NOT NULL
    UNION ALL
    SELECT DISTINCT 'owner'::text,p.email FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE (p_kind='cancelled' OR has_previous) AND m.facility_id=b.facility_id AND m.role IN ('owner','admin')
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
REVOKE ALL ON FUNCTION public.publish_customer_booking_transition_email_dated(uuid,text,date,time,time,date) FROM PUBLIC,anon,authenticated,service_role;

-- The facility/account locks match booking creation and settings changes. All
-- checks and outbox inserts share the transaction with the single final update.
CREATE FUNCTION public.change_customer_booking_dated_atomic(
  p_booking_id uuid, p_user_id uuid, p_booking_date date, p_start_time time,
  p_end_date date, p_end_time time, p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS TABLE(id uuid,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; v_staff uuid; v_buffer integer; v_menus uuid[];
  v_nominated boolean; v_minutes numeric; v_old_minutes numeric;
  v_rule text; v_hours integer; v_rate integer;
BEGIN
  IF p_booking_id IS NULL OR p_user_id IS NULL OR p_booking_date IS NULL OR p_start_time IS NULL
    OR p_end_date IS NULL OR p_end_time IS NULL OR p_start_time=time '24:00'
    OR p_end_date NOT BETWEEN p_booking_date AND p_booking_date+1
    OR p_end_date+p_end_time <= p_booking_date+p_start_time
    OR p_end_date+p_end_time > p_booking_date+p_start_time+interval '8 hours'
    THEN RAISE EXCEPTION 'BOOKING_INVALID_INTERVAL'; END IF;
  PERFORM public.lock_booking_account(p_user_id);
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF b.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || b.facility_id::text,0));
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id FOR UPDATE;
  IF b.user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN'; END IF;
  IF b.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'BOOKING_NOT_CHANGEABLE'; END IF;
  IF b.booking_date=p_booking_date AND b.start_time=p_start_time AND b.end_time=p_end_time
     AND COALESCE(b.end_date,b.booking_date)=p_end_date THEN RETURN QUERY SELECT p_booking_id,true; RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.facility_special_hours WHERE facility_id=b.facility_id)
    AND b.end_date IS NULL AND p_end_date=p_booking_date THEN
    RETURN QUERY SELECT * FROM public.change_customer_booking_with_channels_atomic(
      p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,true);
    RETURN;
  END IF;
  IF (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo' < clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_ALREADY_STARTED'; END IF;
  IF (p_booking_date+p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_SLOT_PASSED'; END IF;
  v_old_minutes:=extract(epoch FROM ((COALESCE(b.end_date,b.booking_date)+b.end_time)-(b.booking_date+b.start_time)))/60;
  IF b.end_date IS NULL THEN v_old_minutes:=least(480,greatest(15,CASE WHEN v_old_minutes>0 THEN floor(v_old_minutes) ELSE 60 END)); END IF;
  v_minutes:=extract(epoch FROM ((p_end_date+p_end_time)-(p_booking_date+p_start_time)))/60;
  IF v_old_minutes IS DISTINCT FROM v_minutes THEN RAISE EXCEPTION 'BOOKING_DURATION_MISMATCH'; END IF;
  SELECT p.cancel_rule,p.free_cancel_hours,p.late_cancel_rate INTO v_rule,v_hours,v_rate
    FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id FOR SHARE;
  IF FOUND AND (v_rule IS NULL OR v_rule='free_window') AND COALESCE(v_hours,24)>0 AND COALESCE(v_rate,0)>0
    AND (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo' < clock_timestamp()+make_interval(hours=>COALESCE(v_hours,24))
    THEN RAISE EXCEPTION 'BOOKING_CHANGE_WINDOW_CLOSED'; END IF;
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=b.facility_id FOR SHARE;
  PERFORM m.id FROM public.facility_menus m WHERE m.facility_id=b.facility_id AND m.is_published IS DISTINCT FROM false FOR SHARE;
  PERFORM p.id FROM public.facility_photos p WHERE p.facility_id=b.facility_id FOR SHARE;
  PERFORM s.id FROM public.staff_profiles s WHERE s.facility_id=b.facility_id AND s.is_active FOR SHARE;
  IF NOT public.facility_booking_ready(b.facility_id) THEN RAISE EXCEPTION 'BOOKING_NOT_READY'; END IF;
  IF p_end_date<>p_booking_date AND NOT COALESCE((SELECT s.allow_overnight_bookings
    FROM public.facility_special_hours s WHERE s.facility_id=b.facility_id),false) THEN RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS'; END IF;
  IF NOT public.facility_interval_admissible(b.facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,
    p_holiday_dates,p_holiday_from,p_holiday_through) THEN RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS'; END IF;
  SELECT COALESCE(f.booking_buffer_minutes,0) INTO v_buffer FROM public.facility_profiles f WHERE f.id=b.facility_id;
  v_menus:=ARRAY(SELECT DISTINCT m.id FROM unnest(array_append(COALESCE(b.menu_ids,ARRAY[]::uuid[]),b.menu_id)) m(id) WHERE m.id IS NOT NULL);
  v_nominated:=b.staff_id IS NOT NULL AND b.staff_auto_assigned IS NOT TRUE;
  IF public.booking_unassigned_interval_capacity_full(b.facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,p_booking_id)
    THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  IF v_nominated THEN
    v_staff:=b.staff_id;
    IF NOT EXISTS(SELECT 1 FROM public.staff_profiles s WHERE s.id=v_staff AND s.facility_id=b.facility_id AND s.is_active)
      OR NOT public.booking_staff_works_interval(v_staff,p_booking_date,p_start_time,p_end_date,p_end_time)
      THEN RAISE EXCEPTION 'STAFF_NOT_WORKING'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(v_menus) m(id) WHERE EXISTS(SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id=m.id AND ms.staff_id=v_staff))
      THEN RAISE EXCEPTION 'BOOKING_NO_CAPABLE_STAFF'; END IF;
    IF public.booking_staff_interval_conflict(b.facility_id,v_staff,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,p_booking_id)
      THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  ELSE
    v_staff:=public.booking_pick_free_staff_interval(b.facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,v_menus,p_booking_id,b.staff_id);
    IF v_staff IS NULL THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  END IF;
  UPDATE public.bookings SET booking_date=p_booking_date,start_time=p_start_time,end_time=p_end_time,
    end_date=CASE WHEN p_end_date=p_booking_date THEN NULL ELSE p_end_date END,
    staff_id=v_staff,staff_auto_assigned=NOT v_nominated,updated_at=clock_timestamp() WHERE bookings.id=p_booking_id;
  PERFORM public.publish_customer_booking_transition_email_dated(p_booking_id,'rescheduled',b.booking_date,b.start_time,b.end_time,b.end_date);
  PERFORM public.publish_customer_booking_channels(p_booking_id,'rescheduled');
  RETURN QUERY SELECT p_booking_id,false;
END $$;
REVOKE ALL ON FUNCTION public.change_customer_booking_dated_atomic(uuid,uuid,date,time,date,time,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_booking_dated_atomic(uuid,uuid,date,time,date,time,date[],date,date) TO service_role;
