DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.facility_special_hours') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END $guard$;

-- Holiday dates and coverage come from the server's verified calendar fetch,
-- never directly from an anonymous client. Unavailable data must not become an
-- implicit weekday. A date closure includes the previous night's tail.
CREATE FUNCTION public.facility_business_windows_for_date(
  p_facility_id uuid, p_date date, p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS TABLE(start_min numeric,end_min numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_hours jsonb; v_settings public.facility_special_hours%ROWTYPE;
  v_dow integer; v_keys text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
  v_previous date; v_previous_closed boolean;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL THEN RAISE EXCEPTION 'INVALID_BUSINESS_DATE'; END IF;
  SELECT f.business_hours INTO v_hours FROM public.facility_profiles f WHERE f.id=p_facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  SELECT * INTO v_settings FROM public.facility_special_hours s WHERE s.facility_id=p_facility_id;
  v_dow := extract(dow FROM p_date)::integer;
  IF NOT FOUND THEN RETURN QUERY SELECT w.start_min,w.end_min FROM public.business_day_windows(v_hours,v_dow) w; RETURN; END IF;

  IF p_date = ANY(v_settings.closed_dates) THEN RETURN; END IF;
  IF v_settings.close_on_public_holidays THEN
    IF p_holiday_dates IS NULL OR p_holiday_from IS NULL OR p_holiday_through IS NULL
      OR p_date < p_holiday_from OR p_date > p_holiday_through
      OR array_position(p_holiday_dates,NULL) IS NOT NULL THEN RAISE EXCEPTION 'HOLIDAY_CALENDAR_UNAVAILABLE'; END IF;
    IF p_date = ANY(p_holiday_dates) THEN RETURN; END IF;
  END IF;
  v_previous := p_date - 1;
  v_previous_closed := v_previous = ANY(v_settings.closed_dates);
  IF NOT v_previous_closed AND v_settings.close_on_public_holidays THEN
    IF v_previous < p_holiday_from OR v_previous > p_holiday_through THEN RAISE EXCEPTION 'HOLIDAY_CALENDAR_UNAVAILABLE'; END IF;
    v_previous_closed := v_previous = ANY(p_holiday_dates);
  END IF;
  IF v_previous_closed AND jsonb_typeof(v_hours)='object' THEN
    v_hours := jsonb_set(v_hours,ARRAY[v_keys[((v_dow+6)%7)+1]],'null'::jsonb,true);
  END IF;
  RETURN QUERY SELECT w.start_min,w.end_min FROM public.business_day_windows(v_hours,v_dow) w;
END $$;
REVOKE ALL ON FUNCTION public.facility_business_windows_for_date(uuid,date,date[],date,date) FROM PUBLIC,anon,authenticated;

-- Merge continuous openings before subtracting the cutoff. Looking two days
-- ahead prevents 24-hour operations from acquiring a false midnight cutoff.
CREATE FUNCTION public.facility_reception_windows_for_date(
  p_facility_id uuid, p_date date, p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS TABLE(start_min numeric,end_min numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cutoff integer; v_offset integer; v_span record; v_window record;
  v_ranges numrange[] := ARRAY[]::numrange[];
BEGIN
  SELECT s.reception_cutoff_minutes INTO v_cutoff FROM public.facility_special_hours s WHERE s.facility_id=p_facility_id;
  IF v_cutoff IS NULL THEN
    RETURN QUERY SELECT w.start_min,w.end_min FROM public.facility_business_windows_for_date(
      p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w;
    RETURN;
  END IF;
  FOR v_offset IN -1..2 LOOP
    FOR v_window IN SELECT * FROM public.facility_business_windows_for_date(
      p_facility_id,p_date+v_offset,p_holiday_dates,p_holiday_from,p_holiday_through) LOOP
      v_ranges := array_append(v_ranges,numrange(v_window.start_min+v_offset*1440,v_window.end_min+v_offset*1440,'[)'));
    END LOOP;
  END LOOP;
  FOR v_span IN SELECT lower(r) AS lo,upper(r) AS hi FROM unnest((SELECT range_agg(r) FROM unnest(v_ranges) r)) r LOOP
    IF greatest(v_span.lo,0) < least(v_span.hi-v_cutoff,1440) THEN
      start_min := greatest(v_span.lo,0); end_min := least(v_span.hi-v_cutoff,1440); RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.facility_reception_windows_for_date(uuid,date,date[],date,date) FROM PUBLIC,anon,authenticated;

-- Final atomic booking checks call the same date windows as the slot reader.
-- The reception deadline limits the start, while the whole appointment must
-- remain inside operating hours (including the following calendar day).
CREATE FUNCTION public.facility_interval_admissible(
  p_facility_id uuid, p_date date, p_start time, p_end_date date, p_end time,
  p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_start numeric; v_end numeric;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL OR p_start IS NULL OR p_end_date IS NULL OR p_end IS NULL
    OR p_start=time '24:00' OR p_end_date NOT BETWEEN p_date AND p_date+1
    OR p_end_date+p_end <= p_date+p_start OR p_end_date+p_end > p_date+p_start+interval '8 hours' THEN RETURN false; END IF;
  v_start:=extract(epoch FROM p_start)/60;
  v_end:=extract(epoch FROM p_end)/60;
  IF NOT EXISTS(SELECT 1 FROM public.facility_reception_windows_for_date(p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w
      WHERE w.start_min<=v_start AND v_start<w.end_min) THEN RETURN false; END IF;
  IF p_end_date=p_date THEN
    RETURN EXISTS(SELECT 1 FROM public.facility_business_windows_for_date(p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w
      WHERE w.start_min<=v_start AND w.end_min>=v_end);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.facility_business_windows_for_date(p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w
      WHERE w.start_min<=v_start AND w.end_min=1440) THEN RETURN false; END IF;
  IF v_end=0 THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM public.facility_business_windows_for_date(p_facility_id,p_end_date,p_holiday_dates,p_holiday_from,p_holiday_through) w
    WHERE w.start_min=0 AND w.end_min>=v_end);
END $$;
REVOKE ALL ON FUNCTION public.facility_interval_admissible(uuid,date,time,date,time,date[],date,date) FROM PUBLIC,anon,authenticated;

-- The original same-day slot function remains the authority for its slots.
-- Extend it with cross-midnight slots only when both days, the same staff and
-- all booked/unassigned capacity cover the entire interval.
CREATE FUNCTION public.get_available_slots_dated(
  p_facility_id uuid, p_staff_id uuid, p_date date, p_duration_minutes integer,
  p_exclude_booking_id uuid, p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS TABLE(slot_start time,slot_end time,end_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_slot record; v_start time; v_start_min numeric; v_end_ts timestamp;
  v_override public.schedule_overrides%ROWTYPE; v_buffer integer;
  v_open nummultirange; v_reception nummultirange; v_next_open nummultirange; v_next_loaded boolean := false;
BEGIN
  IF p_facility_id IS NULL OR p_staff_id IS NULL OR p_date IS NULL OR p_duration_minutes NOT BETWEEN 15 AND 480
    OR p_duration_minutes IS NULL THEN RETURN; END IF;
  IF NOT public.facility_booking_ready(p_facility_id) OR NOT EXISTS(
    SELECT 1 FROM public.staff_profiles s WHERE s.id=p_staff_id AND s.facility_id=p_facility_id AND s.is_active
  ) THEN RETURN; END IF;
  SELECT COALESCE(f.booking_buffer_minutes,0) INTO v_buffer FROM public.facility_profiles f WHERE f.id=p_facility_id;
  -- Force resolution before returning any slots so unknown holiday data cannot
  -- silently become a partial result.
  SELECT COALESCE(range_agg(numrange(w.start_min,w.end_min,'[)')),'{}'::nummultirange) INTO v_open
    FROM public.facility_business_windows_for_date(p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w;
  SELECT COALESCE(range_agg(numrange(w.start_min,w.end_min,'[)')),'{}'::nummultirange) INTO v_reception
    FROM public.facility_reception_windows_for_date(p_facility_id,p_date,p_holiday_dates,p_holiday_from,p_holiday_through) w;

  FOR v_slot IN SELECT * FROM public.get_available_slots(p_facility_id,p_staff_id,p_date,p_duration_minutes,p_exclude_booking_id) LOOP
    IF numrange(extract(epoch FROM v_slot.slot_start)/60,extract(epoch FROM v_slot.slot_end)/60,'[)') <@ v_open
      AND extract(epoch FROM v_slot.slot_start)/60 <@ v_reception THEN
      slot_start:=v_slot.slot_start; slot_end:=v_slot.slot_end; end_date:=p_date; RETURN NEXT;
    END IF;
  END LOOP;

  IF NOT COALESCE((SELECT s.allow_overnight_bookings FROM public.facility_special_hours s WHERE s.facility_id=p_facility_id),false) THEN RETURN; END IF;
  SELECT * INTO v_override FROM public.schedule_overrides o WHERE o.staff_id=p_staff_id AND o.date=p_date;
  IF FOUND AND v_override.is_holiday IS TRUE THEN RETURN; END IF;
  v_start:=v_override.start_time;
  IF v_start IS NULL THEN SELECT s.start_time INTO v_start FROM public.staff_schedules s
    WHERE s.staff_id=p_staff_id AND s.day_of_week=extract(dow FROM p_date)::integer; END IF;
  IF v_start IS NULL OR v_start=time '24:00' THEN RETURN; END IF;
  v_start_min:=extract(epoch FROM v_start)/60;
  WHILE v_start_min < 1440 LOOP
    IF v_start_min+p_duration_minutes > 1440 THEN
      v_end_ts:=p_date::timestamp + pg_catalog.make_interval(mins => (v_start_min+p_duration_minutes)::integer);
      IF NOT v_next_loaded THEN
        SELECT COALESCE(range_agg(numrange(w.start_min,w.end_min,'[)')),'{}'::nummultirange) INTO v_next_open
          FROM public.facility_business_windows_for_date(p_facility_id,v_end_ts::date,p_holiday_dates,p_holiday_from,p_holiday_through) w;
        v_next_loaded:=true;
      END IF;
      IF public.booking_staff_works_interval(p_staff_id,p_date,(p_date::timestamp+pg_catalog.make_interval(mins=>v_start_min::integer))::time,v_end_ts::date,v_end_ts::time)
        AND NOT public.booking_staff_interval_conflict(p_facility_id,p_staff_id,p_date,(p_date::timestamp+pg_catalog.make_interval(mins=>v_start_min::integer))::time,v_end_ts::date,v_end_ts::time,v_buffer,p_exclude_booking_id)
        AND NOT public.booking_unassigned_interval_capacity_full(p_facility_id,p_date,(p_date::timestamp+pg_catalog.make_interval(mins=>v_start_min::integer))::time,v_end_ts::date,v_end_ts::time,v_buffer,p_exclude_booking_id)
        AND numrange(v_start_min,1440,'[)') <@ v_open
        AND numrange(0,extract(epoch FROM v_end_ts::time)/60,'[)') <@ v_next_open
        AND v_start_min <@ v_reception
      THEN
        slot_start:=(p_date::timestamp+pg_catalog.make_interval(mins=>v_start_min::integer))::time;
        slot_end:=v_end_ts::time; end_date:=v_end_ts::date; RETURN NEXT;
      END IF;
    END IF;
    v_start_min:=v_start_min+30;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_available_slots_dated(uuid,uuid,date,integer,uuid,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots_dated(uuid,uuid,date,integer,uuid,date[],date,date) TO service_role;

-- Internal gateway for an already-authorized online booking. The existing
-- creator still owns coupon, points, account locking and initial insert logic.
-- A cross-midnight row is finalized inside the same locked transaction before
-- the receipt and notification snapshots can observe it.
CREATE FUNCTION public.create_online_booking_dated_atomic(
  p_facility_id uuid,p_staff_id uuid,p_user_id uuid,p_menu_id uuid,p_coupon_id uuid,
  p_booking_date date,p_start_time time,p_end_date date,p_end_time time,
  p_customer_name text,p_email text,p_phone text,p_note text,p_total_price integer,
  p_points_used integer,p_status text,p_menu_ids uuid[],p_holiday_dates date[],p_holiday_from date,p_holiday_through date
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid; v_selected_staff uuid; v_buffer integer; v_count integer;
BEGIN
  IF p_menu_ids IS NULL OR cardinality(p_menu_ids) NOT BETWEEN 1 AND 20 OR p_menu_ids[1] IS DISTINCT FROM p_menu_id
    OR EXISTS(SELECT 1 FROM unnest(p_menu_ids) m(id) WHERE m.id IS NULL)
    OR (SELECT count(DISTINCT m.id) FROM unnest(p_menu_ids) m(id)) <> cardinality(p_menu_ids)
    THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE'; END IF;
  IF p_booking_date IS NULL OR p_start_time IS NULL OR p_end_date IS NULL OR p_end_time IS NULL
    OR (p_booking_date+p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_SLOT_PASSED: 選択した時間は過ぎています'; END IF;
  PERFORM public.lock_booking_account(p_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM id FROM public.facility_profiles WHERE id=p_facility_id FOR SHARE;
  PERFORM id FROM public.facility_menus WHERE id=ANY(p_menu_ids) ORDER BY id FOR SHARE;
  SELECT count(*) INTO v_count FROM public.facility_menus
    WHERE id=ANY(p_menu_ids) AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false;
  IF v_count <> cardinality(p_menu_ids) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE'; END IF;
  IF NOT public.facility_interval_admissible(p_facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,
      p_holiday_dates,p_holiday_from,p_holiday_through) THEN RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS'; END IF;
  IF p_end_date=p_booking_date THEN
    RETURN public.create_online_booking_atomic(p_facility_id,p_staff_id,p_user_id,p_menu_id,p_coupon_id,
      p_booking_date,p_start_time,p_end_time,p_customer_name,p_email,p_phone,p_note,p_total_price,p_points_used,p_status,p_menu_ids);
  END IF;
  IF NOT COALESCE((SELECT s.allow_overnight_bookings FROM public.facility_special_hours s WHERE s.facility_id=p_facility_id),false)
    THEN RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS'; END IF;
  SELECT COALESCE(f.booking_buffer_minutes,0) INTO v_buffer FROM public.facility_profiles f WHERE f.id=p_facility_id;
  IF public.booking_unassigned_interval_capacity_full(p_facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,NULL)
    THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  IF p_staff_id IS NULL THEN
    v_selected_staff:=public.booking_pick_free_staff_interval(p_facility_id,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,p_menu_ids,NULL,NULL);
    IF v_selected_staff IS NULL THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  ELSE
    v_selected_staff:=p_staff_id;
    IF NOT EXISTS(SELECT 1 FROM public.staff_profiles s WHERE s.id=p_staff_id AND s.facility_id=p_facility_id AND s.is_active)
      OR NOT public.booking_staff_works_interval(p_staff_id,p_booking_date,p_start_time,p_end_date,p_end_time)
      THEN RAISE EXCEPTION 'STAFF_NOT_WORKING'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(p_menu_ids) m(id)
      WHERE EXISTS(SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id=m.id AND ms.staff_id=p_staff_id))
      THEN RAISE EXCEPTION 'BOOKING_NO_CAPABLE_STAFF'; END IF;
    IF public.booking_staff_interval_conflict(p_facility_id,p_staff_id,p_booking_date,p_start_time,p_end_date,p_end_time,v_buffer,NULL)
      THEN RAISE EXCEPTION 'BOOKING_CONFLICT'; END IF;
  END IF;
  v_id:=public.create_booking_for_menus_atomic(p_facility_id,v_selected_staff,p_user_id,p_menu_id,p_coupon_id,
    p_booking_date,p_start_time,time '24:00',p_customer_name,p_email,p_phone,p_note,p_total_price,p_points_used,p_status,true,p_menu_ids);
  UPDATE public.bookings SET end_date=p_end_date,end_time=p_end_time,staff_auto_assigned=(p_staff_id IS NULL),
    menu_ids=CASE WHEN cardinality(p_menu_ids)>1 THEN p_menu_ids ELSE menu_ids END WHERE id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_online_booking_dated_atomic(uuid,uuid,uuid,uuid,uuid,date,time,date,time,text,text,text,text,integer,integer,text,uuid[],date[],date,date) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the existing receipt/replay and notification checks verbatim while
-- using the dated gateway. Halt on drift rather than silently weakening them.
DO $dated_receipt$
DECLARE definition text; original text;
BEGIN
  definition := pg_get_functiondef('public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb)'::regprocedure);
  original := definition;
  definition := replace(definition,'FUNCTION public.create_booking_with_receipt_atomic(', 'FUNCTION public.create_booking_with_receipt_dated_atomic(');
  definition := replace(definition,'p_menu_ids uuid[], p_notifications jsonb)', 'p_menu_ids uuid[], p_notifications jsonb, p_end_date date, p_holiday_dates date[], p_holiday_from date, p_holiday_through date)');
  definition := replace(definition,$old$booking_new_id:=public.create_online_booking_atomic(p_facility_id,p_staff_id,p_actor_id,p_menu_id,p_coupon_id,p_booking_date,p_start_time,p_end_time,
    p_customer_name,p_email,p_phone,p_note,p_total_price,p_points_used,p_status,p_menu_ids);$old$,
    $new$booking_new_id:=public.create_online_booking_dated_atomic(p_facility_id,p_staff_id,p_actor_id,p_menu_id,p_coupon_id,p_booking_date,p_start_time,p_end_date,p_end_time,
    p_customer_name,p_email,p_phone,p_note,p_total_price,p_points_used,p_status,p_menu_ids,p_holiday_dates,p_holiday_from,p_holiday_through);$new$);
  definition := replace(definition,'  FOR item IN SELECT value FROM jsonb_array_elements(p_notifications) LOOP',
    '  IF b.end_date IS NOT NULL AND b.end_date <> b.booking_date THEN snapshot:=snapshot || jsonb_build_object(''end_date'',b.end_date::text); END IF;' || chr(10) ||
    '  FOR item IN SELECT value FROM jsonb_array_elements(p_notifications) LOOP');
  -- Non-email channels have strict legacy snapshot schemas and do not display
  -- the end of the appointment. Keep their payload unchanged.
  definition := replace(definition, '''end_time'',''total_price'',''status'']', '''end_time'',''total_price'',''status'',''end_date'']');
  definition := replace(definition, '  UPDATE public.booking_create_operations SET state=''committed''',
    '  IF b.end_date IS NOT NULL AND b.end_date <> b.booking_date THEN response:=response || jsonb_build_object(''endDate'',b.end_date::text); END IF;' || chr(10) ||
    '  UPDATE public.booking_create_operations SET state=''committed''');
  IF definition=original OR strpos(definition,'FUNCTION public.create_booking_with_receipt_dated_atomic(')=0
    OR strpos(definition,'p_holiday_through date)')=0 OR strpos(definition,'booking_new_id:=public.create_online_booking_dated_atomic(')=0
    OR strpos(definition,'snapshot:=snapshot || jsonb_build_object(''end_date'',b.end_date::text)')=0
    OR strpos(definition,'response:=response || jsonb_build_object(''endDate'',b.end_date::text)')=0
    THEN RAISE EXCEPTION 'dated booking receipt base drift'; END IF;
  EXECUTE definition;
END $dated_receipt$;
REVOKE ALL ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) TO service_role;

-- Include the explicit ending date in the dispatch-time comparison. Existing
-- frozen snapshots do not contain this extra key and continue to match as before.
DO $notification_fence$
DECLARE definition text; original text;
BEGIN
  definition:=pg_get_functiondef('public.start_booking_create_notification(uuid,timestamptz)'::regprocedure);
  original:=definition;
  definition:=replace(definition,'    snapshot_matches:=jsonb_typeof(q.payload->''booking_snapshot'')',
    '    snapshot:=snapshot || jsonb_build_object(''end_date'',current_booking.end_date::text);' || chr(10) ||
    '    snapshot_matches:=jsonb_typeof(q.payload->''booking_snapshot'')');
  IF definition=original THEN RAISE EXCEPTION 'dated notification fence base drift'; END IF;
  EXECUTE definition;
END $notification_fence$;
