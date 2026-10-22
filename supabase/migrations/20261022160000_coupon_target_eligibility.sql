-- Enforce the coupon target 新規 / リピーター when a booking is created.
--
-- Before: the shop could set a coupon's 対象 to 新規 (new_customer) or リピーター
-- (repeat), but nothing checked it. A returning customer booked at the
-- new-customer price, and a guest (no user_id, so the per-user redemption UNIQUE
-- does not apply) could use a 新規 coupon on every visit. A first-time customer
-- could use a リピーター coupon.
--
-- After: create_booking_for_menus_atomic checks the customer's own history at
-- this facility before the booking row is written:
--   * 新規 / リピーター coupons need a signed-in customer
--     (COUPON_TARGET_LOGIN_REQUIRED). The history is looked up only for the
--     account itself: bookings of p_user_id, and bookings made under the
--     account's own confirmed e-mail (auth.users.email, canonicalised like
--     bookings.email_canonical). The e-mail typed into the booking form
--     (p_email) is never used for the lookup. Matching a typed address would let
--     anyone learn, without the person noticing, whether that address has booked
--     at this facility: a refused booking is rolled back and sends nothing, so
--     COUPON_NEW_CUSTOMER_ONLY would answer "this person is a patient here".
--   * 新規 (COUPON_NEW_CUSTOMER_ONLY): no booking at this facility that was not
--     cancelled (cancelled / cancel_fee_paid do not count; a pending or future
--     booking does, so a second booking made before the first visit cannot use
--     the first-visit price again).
--   * リピーター (COUPON_REPEAT_ONLY): at least one visit at this facility, i.e.
--     a booking with status arrived (受付) or completed (完了). This follows
--     aggregate_daily_revenue (20260627000001: repeat = a completed visit, not
--     merely a booking); arrived is included because the customer is already in
--     the shop and the 完了 step comes later at checkout.
-- /api/booking maps the codes to Japanese messages and refuses guests before
-- calling the RPC. Only this function body changes: same signature, owner,
-- SECURITY DEFINER, search_path and grants (re-stated below). The rest of the
-- body is copied verbatim from 20261022100000_booking_staff_assignment.sql, the
-- latest definition (no later migration patches it).
--
-- Order: safe to apply before or after the application deploy. Bookings without
-- a coupon, with an 全員 / 期間限定 coupon, or by a signed-in customer the coupon
-- is meant for behave as before. Recommended: deploy the application first. The
-- current application still lets a guest pick a 新規 / リピーター coupon and has
-- no message for the new codes, so until it is deployed such a booking is
-- answered with the generic "受付結果を確認できません" 500 instead of the
-- specific message (the booking is refused either way, nothing is written).
--
-- No data rewrite.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_user_id UUID,
  p_menu_id UUID,
  p_coupon_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_points_used INT,
  p_status TEXT,
  p_enforce_schedule BOOLEAN,
  p_menu_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
  v_max_uses INT;
  v_redemption_count INT;
  -- Coupon target (新規／リピーター) check, see below.
  v_coupon_type TEXT;
  v_account_email TEXT;
  v_buffer_minutes INT;
  -- The staff member stored on the reservation: the named one, or the one assigned below.
  v_staff_id UUID := p_staff_id;
  v_menu_ids UUID[];
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = p_facility_id;

  -- スケジュールゲート a.（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    -- Lock the readiness inputs through the public mutation; admin manual booking is unchanged.
    PERFORM id FROM public.facility_profiles WHERE id = p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE facility_id = p_facility_id AND is_published IS DISTINCT FROM false FOR SHARE;
    PERFORM id FROM public.facility_photos WHERE facility_id = p_facility_id FOR SHARE;
    PERFORM id FROM public.staff_profiles WHERE facility_id = p_facility_id AND is_active FOR SHARE;
    SELECT COALESCE(booking_buffer_minutes, 0), business_hours INTO v_buffer_minutes, v_business_hours
    FROM public.facility_profiles WHERE id = p_facility_id;
    PERFORM id FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id FOR SHARE;
    IF NOT public.facility_booking_ready(p_facility_id) THEN
      RAISE EXCEPTION 'BOOKING_NOT_READY: ネット予約は準備中です';
    END IF;
    IF p_staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id AND is_active
    ) THEN RAISE EXCEPTION 'STAFF_NOT_WORKING: 指定スタッフは現在受付していません'; END IF;
    IF p_menu_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false
    ) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE: 選択メニューは現在受付していません'; END IF;
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
  END IF;

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。
    PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません';
    END IF;

    -- スケジュールゲート b.（G1 所属チェックの直後・既存予約重複チェックの前。
    --    公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots と同じ優先順:
    --    schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF p_enforce_schedule THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = p_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_gate_dow;
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

    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    -- A legacy reservation without a staff member still needs one of the working staff.
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    v_menu_ids := ARRAY(
      SELECT DISTINCT chosen.id
      FROM unnest(array_append(COALESCE(p_menu_ids, ARRAY[]::uuid[]), p_menu_id)) AS chosen(id)
      WHERE chosen.id IS NOT NULL
    );

    -- おまかせ: store a concrete free staff member so that later named reservations,
    -- changes and get_available_slots see the slot as taken by that member.
    -- staff_auto_assigned (below) keeps it from reading as a nomination.
    v_staff_id := public.booking_pick_free_staff(p_facility_id, p_booking_date, p_start_time, p_end_time,
      v_buffer_minutes, v_menu_ids, NULL, NULL);

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    SELECT max_uses, coupon_type INTO v_max_uses, v_coupon_type FROM coupons WHERE id = p_coupon_id FOR UPDATE;
    IF v_max_uses IS NOT NULL THEN
      SELECT COUNT(*) INTO v_redemption_count FROM coupon_redemptions WHERE coupon_id = p_coupon_id;
      IF v_redemption_count >= v_max_uses THEN
        RAISE EXCEPTION 'COUPON_LIMIT: このクーポンは利用上限に達しています';
      END IF;
    END IF;
  END IF;

  -- Coupon target (2026-10-22). Only the signed-in account's own history is
  -- consulted, never the e-mail typed into the form (see the header). The
  -- account's e-mail counts only once confirmed, and is canonicalised with the
  -- expression of the generated column bookings.email_canonical
  -- (20260607_email_canonical_column.sql), so earlier guest bookings under the
  -- same address, or a Gmail alias of it, are part of the account's history.
  -- The staff-schedule lock taken at the top serialises every booking of this
  -- facility, so two concurrent first bookings cannot both pass as 新規.
  -- Manual (phone) bookings never pass a coupon and are not affected.
  IF v_coupon_type IN ('new_customer', 'repeat') THEN
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'COUPON_TARGET_LOGIN_REQUIRED: このクーポンはログインしてご利用ください';
    END IF;
    SELECT CASE
        WHEN u.email IS NULL THEN NULL
        WHEN lower(split_part(u.email, '@', 2)) IN ('gmail.com', 'googlemail.com')
         AND length(regexp_replace(split_part(split_part(lower(btrim(u.email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
        THEN regexp_replace(split_part(split_part(lower(btrim(u.email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
        ELSE lower(btrim(u.email))
      END
    INTO v_account_email
    FROM auth.users u
    WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL;
    IF v_coupon_type = 'new_customer' AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.facility_id = p_facility_id
        AND b.status NOT IN ('cancelled', 'cancel_fee_paid')
        AND (b.user_id = p_user_id OR b.email_canonical = v_account_email)
    ) THEN
      RAISE EXCEPTION 'COUPON_NEW_CUSTOMER_ONLY: このクーポンは初めてご予約の方限定です';
    END IF;
    IF v_coupon_type = 'repeat' AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.facility_id = p_facility_id
        AND b.status IN ('arrived', 'completed')
        AND (b.user_id = p_user_id OR b.email_canonical = v_account_email)
    ) THEN
      RAISE EXCEPTION 'COUPON_REPEAT_ONLY: このクーポンはご来店いただいたことがある方限定です';
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, staff_auto_assigned, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, v_staff_id, p_staff_id IS NULL, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status
  )
  RETURNING id INTO v_booking_id;

  IF p_coupon_id IS NOT NULL THEN
    BEGIN
      INSERT INTO coupon_redemptions (coupon_id, user_id, booking_id)
      VALUES (p_coupon_id, p_user_id, v_booking_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'COUPON_ALREADY_USED: このクーポンは既に利用済みです';
    END;
  END IF;

  RETURN v_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  TO service_role;
