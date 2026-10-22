-- Customer date/time changes.
--
-- 1. A reservation whose start time has passed can no longer be moved by the
--    customer (the cancellation already refuses with BOOKING_ALREADY_STARTED).
--    Before, change_booking_atomic accepted it, so a customer could move a
--    reservation they never attended to another day.
-- 2. A named-staff change also counts legacy reservations without a staff
--    member (see 20261022100000_booking_staff_assignment.sql).
-- 3. The shop owner/admin addresses that receive the cancellation email now
--    also receive an email when the customer changes the date/time, with the
--    previous and the new date/time. Before, only the customer was emailed.
--
-- Consumer first: deploy the application (worker accepts the owner change
-- email and the "previous" snapshot) before applying this migration.
-- No data rewrite; historical changes are not re-notified.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- Authoritative body: 20261002012045 + the staff schedule lock of 20261008080210.
CREATE OR REPLACE FUNCTION public.change_booking_atomic(
  p_booking_id UUID,
  p_user_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_enforce_schedule BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_id UUID;
  v_staff_id UUID;
  v_status TEXT;
  v_owner UUID;
  v_old_date DATE;
  v_old_start TIME;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
  v_dow INT;
  v_buffer_minutes INT;
  -- スケジュールゲート専用変数（既存ロジックの変数と共有しない＝既存挙動へ波及させない）
  v_business_hours JSONB;
  v_gate_dow INT;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
  v_gate_is_holiday BOOLEAN;
  v_gate_work_start TIME;
  v_gate_work_end TIME;
BEGIN
  PERFORM public.lock_booking_account(p_user_id);
  SELECT facility_id, staff_id, status, user_id, booking_date, start_time
    INTO v_facility_id, v_staff_id, v_status, v_owner, v_old_date, v_old_start
  FROM bookings
  WHERE id = p_booking_id;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;
  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN';
  END IF;
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'BOOKING_NOT_CHANGEABLE';
  END IF;
  -- Same JST rule as cancel_booking_with_points_atomic: once started, the shop decides.
  IF (v_old_date + v_old_start) AT TIME ZONE 'Asia/Tokyo' < clock_timestamp() THEN
    RAISE EXCEPTION 'BOOKING_ALREADY_STARTED';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || v_facility_id::text,0));
  v_lock_key := ('x' || left(md5(v_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = v_facility_id;

  -- スケジュールゲート（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    -- Lock the readiness inputs through the public mutation; admin manual booking is unchanged.
    PERFORM id FROM public.facility_profiles WHERE id = v_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE facility_id = v_facility_id AND is_published IS DISTINCT FROM false FOR SHARE;
    PERFORM id FROM public.facility_photos WHERE facility_id = v_facility_id FOR SHARE;
    PERFORM id FROM public.staff_profiles WHERE facility_id = v_facility_id AND is_active FOR SHARE;
    SELECT COALESCE(booking_buffer_minutes, 0), business_hours INTO v_buffer_minutes, v_business_hours
    FROM public.facility_profiles WHERE id = v_facility_id;
    PERFORM id FROM public.staff_profiles WHERE id=v_staff_id AND facility_id=v_facility_id FOR SHARE;
    IF NOT public.facility_booking_ready(v_facility_id) THEN
      RAISE EXCEPTION 'BOOKING_NOT_READY: ネット予約は準備中です';
    END IF;
    IF v_staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff_profiles WHERE id=v_staff_id AND facility_id=v_facility_id AND is_active
    ) THEN RAISE EXCEPTION 'STAFF_NOT_WORKING: 担当スタッフは現在受付していません'; END IF;
    v_gate_dow := EXTRACT(DOW FROM p_booking_date)::int;

    -- a. business_hours ゲート（指名/おまかせ共通）。
    --    NULL / 非 object / 曜日キー不在はゲートしない（get_available_slots と同一解釈）。
    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;

    -- b. 指名スタッフ勤務窓ゲート（変更対象予約の担当スタッフに対して。get_available_slots と
    --    同じ優先順: schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF v_staff_id IS NOT NULL THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = v_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = v_staff_id AND ss.day_of_week = v_gate_dow;
      END IF;

      -- 勤務窓が取れない（end_time NULL 含む・NULL 比較で素通りさせない fail-closed）、
      -- または窓が [p_start_time, p_end_time] を包含しない → 拒否。
      IF v_gate_work_start IS NULL
        OR v_gate_work_end IS NULL
        OR v_gate_work_start > p_start_time
        OR v_gate_work_end < p_end_time THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;
    END IF;
  END IF;

  IF v_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = v_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    -- A legacy reservation without a staff member still needs one of the working staff.
    IF public.booking_unassigned_capacity_full(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, p_booking_id) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = v_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    -- G2: おまかせ容量は勤務中スタッフ数（get_available_slots ミラー）。
    v_dow := EXTRACT(DOW FROM p_booking_date)::int;
    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles sp
    WHERE sp.facility_id = v_facility_id
      AND sp.is_active = true
      AND EXISTS (
        -- 相関サブクエリ: ダミー1行に対し当該スタッフ(sp.id)の当日 override と週間 schedule を
        -- LEFT JOIN し、勤務窓が予約時間帯を包含するか判定する（外部 sp.id は ON 句で参照＝相関で正当）。
        SELECT 1
        FROM (SELECT 1) dummy
        LEFT JOIN schedule_overrides so ON so.staff_id = sp.id AND so.date = p_booking_date
        LEFT JOIN staff_schedules ss ON ss.staff_id = sp.id AND ss.day_of_week = v_dow
        WHERE NOT (so.is_holiday IS TRUE)
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) IS NOT NULL
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) <= p_start_time
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.end_time   ELSE ss.end_time   END) >= p_end_time
      );

    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  UPDATE bookings
  SET booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = p_end_time,
      updated_at = NOW()
  WHERE id = p_booking_id;
END;
$$;
-- Preserve the mutation boundary: p_enforce_schedule=false is never public.
REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;

-- Publisher (20261013082022) with the previous date/time of a change. The owner
-- recipients are the same deduplicated owner/admin addresses as cancellations.
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
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'customerName',b.customer_name,'customerEmail',coalesce(b.email,''),'facilityName',f.name,
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',menu_name,
    'totalPrice',b.total_price,'capturedAt',clock_timestamp(),'cancelPolicy',policy);
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
REVOKE ALL ON FUNCTION public.publish_customer_booking_transition_email(uuid,text,date,time,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_customer_booking_transition_email(uuid,text,date,time,time) TO service_role;

-- Existing two-argument entry point (cancellation gateway) keeps its behaviour.
CREATE OR REPLACE FUNCTION public.publish_customer_booking_transition_email(p_booking_id uuid,p_kind text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN public.publish_customer_booking_transition_email(p_booking_id,p_kind,NULL::date,NULL::time,NULL::time);
END $$;
REVOKE ALL ON FUNCTION public.publish_customer_booking_transition_email(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_customer_booking_transition_email(uuid,text) TO service_role;

-- Receipt gateway (20261013094432): pass the date/time read before the change.
CREATE OR REPLACE FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(p_booking_id uuid,p_user_id uuid,
  p_booking_date date,p_start_time time,p_end_time time,p_enforce_schedule boolean DEFAULT true)
RETURNS TABLE(id uuid,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_booking public.bookings%ROWTYPE;
BEGIN
  PERFORM public.lock_booking_account(p_user_id);
  SELECT * INTO old_booking FROM public.bookings WHERE bookings.id=p_booking_id;
  IF FOUND AND old_booking.user_id=p_user_id AND old_booking.status IN ('pending','confirmed')
    AND old_booking.booking_date=p_booking_date AND old_booking.start_time=p_start_time
    AND old_booking.end_time=p_end_time THEN
    RETURN QUERY SELECT p_booking_id,true;
    RETURN;
  END IF;
  PERFORM public.change_booking_atomic(p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,p_enforce_schedule);
  UPDATE public.bookings SET updated_at=clock_timestamp() WHERE bookings.id=p_booking_id;
  PERFORM public.publish_customer_booking_transition_email(p_booking_id,'rescheduled',
    old_booking.booking_date,old_booking.start_time,old_booking.end_time);
  RETURN QUERY SELECT p_booking_id,false;
END $$;
REVOKE ALL ON FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(uuid,uuid,date,time,time,boolean) TO service_role;
