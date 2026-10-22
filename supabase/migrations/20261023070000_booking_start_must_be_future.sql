-- A reservation can no longer be made for, or moved to, a time that has already
-- started (2026-10-23).
--
-- Before: the availability API hides today's slots whose start has passed, but
-- only at the moment the booking page fetches them. A visitor who kept the page
-- open (13:50 → 14:10) could still book 14:00, and a hand-made request could
-- book 09:00 at 20:00 the same day. Nothing in /api/booking, the receipt
-- gateway or create_booking_for_menus_atomic compared the start with the
-- current time, so the reservation was created, the shop was notified, and the
-- customer could neither cancel nor change it online (both refuse once the
-- start has passed). A customer date change had the same hole for the new time.
--
-- After:
--  * create_online_booking_atomic (the only public creation path; the receipt
--    gateway calls it as owner) raises BOOKING_SLOT_PASSED when
--    booking_date + start_time (JST) <= clock_timestamp(). Manual (phone)
--    bookings by the shop do not go through it and are unchanged (recording a
--    visit afterwards stays possible).
--  * change_booking_atomic raises BOOKING_SLOT_PASSED for a new time that has
--    started, on the public path only (p_enforce_schedule = true).
--  * /api/booking and /api/booking/[id]/change check the same rule first and
--    show 「選択した時間はすでに過ぎています。日時を選び直してください。」.
--
-- Both functions are copies of their latest definitions with only the lines
-- marked "2026-10-23" added (signature, owner, SECURITY, search_path unchanged;
-- REVOKE / GRANT restated):
--   create_online_booking_atomic … 20261022100000_booking_staff_assignment.sql
--   change_booking_atomic        … 20261022100100_customer_booking_change_guards.sql
-- Neither has been patched by a later migration or DO block since.
--
-- Order: safe to apply before or after the application deploy. Only requests
-- for a time that has already started are refused; the current application
-- shows those as 「予約の受付結果を確認できません」 (create) or 「変更に失敗しました」
-- (change) until the new application, which maps the code, is deployed.
-- No data rewrite.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.create_online_booking_atomic(
  p_facility_id uuid, p_staff_id uuid, p_user_id uuid, p_menu_id uuid,
  p_coupon_id uuid, p_booking_date date, p_start_time time, p_end_time time,
  p_customer_name text, p_email text, p_phone text, p_note text,
  p_total_price int, p_points_used int, p_status text, p_menu_ids uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE new_id uuid; selected_count int;
BEGIN
  IF p_menu_ids IS NULL OR cardinality(p_menu_ids) < 1 OR cardinality(p_menu_ids) > 20
    OR p_menu_ids[1] IS DISTINCT FROM p_menu_id
    OR EXISTS (SELECT 1 FROM unnest(p_menu_ids) m(id) WHERE m.id IS NULL)
    OR (SELECT count(DISTINCT m.id) FROM unnest(p_menu_ids) m(id)) <> cardinality(p_menu_ids) THEN
    RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE';
  END IF;
  -- 2026-10-23: a slot whose start (JST) has passed is not bookable online. Same
  -- rule as the availability API (a slot is offered only while slot_start > now).
  IF (p_booking_date + p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp() THEN
    RAISE EXCEPTION 'BOOKING_SLOT_PASSED: 選択した時間は過ぎています';
  END IF;
  PERFORM public.lock_booking_account(p_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || p_booking_date::text),16))::bit(64)::bigint);
  PERFORM id FROM public.facility_profiles WHERE id=p_facility_id FOR SHARE;
  -- Lock actual selected rows, including currently hidden ones, before checking.
  PERFORM id FROM public.facility_menus WHERE id=ANY(p_menu_ids) ORDER BY id FOR SHARE;
  SELECT count(*) INTO selected_count FROM public.facility_menus
    WHERE id=ANY(p_menu_ids) AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false;
  IF selected_count <> cardinality(p_menu_ids) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE'; END IF;
  new_id := public.create_booking_for_menus_atomic(p_facility_id,p_staff_id,p_user_id,p_menu_id,
    p_coupon_id,p_booking_date,p_start_time,p_end_time,p_customer_name,p_email,p_phone,p_note,
    p_total_price,p_points_used,p_status,true,p_menu_ids);
  IF cardinality(p_menu_ids) > 1 THEN
    UPDATE public.bookings SET menu_ids=p_menu_ids WHERE id=new_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  END IF;
  RETURN new_id;
END;
$$;
-- Only the receipt gateway (as its owner) may call it; see 20261009005709.
REVOKE ALL ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM service_role;

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
  v_auto_assigned BOOLEAN;
  v_menu_id UUID;
  v_menu_ids UUID[];
  -- Only a nominated reservation keeps its staff member; otherwise it is assigned again.
  v_nominated BOOLEAN;
  v_conflict_count INT;
  v_lock_key BIGINT;
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
  SELECT facility_id, staff_id, status, user_id, booking_date, start_time, staff_auto_assigned, menu_id, menu_ids
    INTO v_facility_id, v_staff_id, v_status, v_owner, v_old_date, v_old_start, v_auto_assigned, v_menu_id, v_menu_ids
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
  -- 2026-10-23: the new time must not have started either (public path only;
  -- the same rule as a new online booking). Before, a customer could move a
  -- reservation to a time of today that had already passed.
  IF p_enforce_schedule AND (p_booking_date + p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp() THEN
    RAISE EXCEPTION 'BOOKING_SLOT_PASSED: 選択した時間は過ぎています';
  END IF;
  v_nominated := v_staff_id IS NOT NULL AND v_auto_assigned IS NOT TRUE;

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
    IF v_nominated AND NOT EXISTS (
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

    -- b. 指名スタッフ勤務窓ゲート（指名予約の担当スタッフに対して。get_available_slots と
    --    同じ優先順: schedule_overrides の当日行 → staff_schedules の当曜日行）。
    --    指名なし（おまかせ）は下の割り当てが勤務窓を満たすスタッフだけを選ぶ。
    IF v_nominated THEN
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

  IF v_nominated THEN
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

    -- A reservation that needs any working staff still needs one of them.
    IF public.booking_unassigned_capacity_full(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, p_booking_id) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    IF public.booking_unassigned_capacity_full(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, p_booking_id) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    -- 指名なし: the same assignment as a new おまかせ reservation (every booked menu,
    -- the reservation itself excluded), keeping the current member while free.
    v_staff_id := public.booking_pick_free_staff(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes,
      ARRAY(
        SELECT DISTINCT chosen.id
        FROM unnest(array_append(COALESCE(v_menu_ids, ARRAY[]::uuid[]), v_menu_id)) AS chosen(id)
        WHERE chosen.id IS NOT NULL
      ),
      p_booking_id, v_staff_id);

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  UPDATE bookings
  SET booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = p_end_time,
      staff_id = v_staff_id,
      staff_auto_assigned = NOT v_nominated,
      updated_at = NOW()
  WHERE id = p_booking_id;
END;
$$;
-- Preserve the mutation boundary: p_enforce_schedule=false is never public (grants as in 20261022100100).
REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;
