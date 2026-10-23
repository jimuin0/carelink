-- Online booking needs a staff member whose working time meets the shop's business
-- hours, and おまかせ refusals say when nobody can handle the chosen menus
-- (2026-10-23).
--
-- 【1. 予約OK なのに毎日 満枠】facility_booking_ready and facility_card_view.active_staff_count
--   (20261023080000) counted an active staff member as able to take bookings when they had
--   ANY weekly working day or upcoming working special day. get_available_slots clamps the
--   working window to the shop's business hours and returns nothing on a closed day, so a
--   shop whose staff work only outside its hours (e.g. hours Mon-Fri 10:00-19:00, staff
--   saved Sat/Sun only, or 07:00-09:00) showed 「予約OK」 on its search card and passed the
--   readiness gate, while its calendar read 満枠 on every day.
--   Now public.staff_has_working_time also requires the window to leave some time inside
--   the business hours of its weekday (public.working_time_meets_business_hours, the same
--   reading of business_hours as get_available_slots). facility_booking_ready and
--   facility_card_view call staff_has_working_time and are NOT redefined: their bodies,
--   column list and order, grants and comments are unchanged. The app mirror is
--   readWorkingStaff / summarizeWorkingStaff / workingTimeMeetsBusinessHours
--   (src/lib/facility-publish-gate.ts).
--   Production (2026-10-23, per the task brief): the 3 published facilities have staff
--   schedules that overlap their hours, so none of them stops being bookable. Check it
--   before applying with scripts/diagnose-booking-ready-hours-overlap.sql (SELECT only):
--   every published facility that is ready today must still be ready.
--
-- 【2. メニューを担当できるスタッフがいないのに「既に予約が入っています」】When nobody was
--   nominated and no free member could be assigned, create_booking_for_menus_atomic and
--   change_booking_atomic raised BOOKING_CONFLICT even when the slot was empty and the
--   reason was menu_staff: the members who work the slot cannot do the chosen menus.
--   They now raise
--     BOOKING_NO_CAPABLE_STAFF: 選択したメニューを担当できるスタッフがいません
--   when at least one active member works the slot and none of those handles every
--   chosen menu (the menu_staff rule of booking_pick_free_staff). Everything else is
--   unchanged: no working member at all keeps BOOKING_NO_WORKING_STAFF (manual) /
--   BOOKING_CONFLICT (online); capable members who are all busy keep BOOKING_CONFLICT.
--   /api/booking, /api/booking/[id]/change and /api/admin/bookings map the new code to 409.
--
-- Both booking functions are copies of their latest definitions with only the lines
-- marked BOOKING_NO_CAPABLE_STAFF added:
--   * create_booking_for_menus_atomic — 20261023130100_manual_unassigned_booking_no_working_staff.sql
--   * change_booking_atomic           — 20261023164100_customer_change_closes_with_free_cancel_window.sql
-- No later migration, DO block or pg_get_functiondef rewrite redefines either.
-- Signatures, SECURITY DEFINER, search_path and REVOKE / GRANT are restated unchanged.
-- staff_has_working_time keeps its signature, SECURITY INVOKER, search_path and grants.
--
-- Apply order: after every migration up to 20261023170000_publish_requires_confirmed_hours.sql,
-- and AFTER deploying the application that knows BOOKING_NO_CAPABLE_STAFF. The deployed
-- application does not know the code: applied first, an おまかせ booking refused for this
-- reason would read as 500 「予約の受付結果を確認できません」 (online) or
-- 「予約結果を確認できません」 (board) instead of a 409. Nothing is stored either way.
-- The new application works on the old database (it then simply never receives the code;
-- its readiness mirror is already the new rule, so between the deploy and this migration a
-- shop whose staff never meet its hours can show 「予約OK」 on a card while its page says
-- ネット予約は準備中 — apply promptly after the deploy).
-- No data rewrite. Verified in a disposable DB by supabase/shadow/booking-ready-hours-overlap-fixtures.sql.

DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- 1. Does a working window (a weekly row, or a working special day) leave any time
--    inside the shop's business hours on that weekday? The same reading of
--    business_hours as get_available_slots: no hours / not an object / no key for
--    the day = not gated; the day's value JSON null = closed; {open, close} clamps
--    the window. A value get_available_slots could not read (not HH:MM[:SS]) opens
--    nothing here instead of raising, because the search card view evaluates this
--    for every published shop. Mirrored by workingTimeMeetsBusinessHours
--    (src/lib/facility-publish-gate.ts).
CREATE OR REPLACE FUNCTION public.working_time_meets_business_hours(
  p_hours jsonb, p_dow integer, p_start time, p_end time
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_day jsonb;
  v_open text;
  v_close text;
  v_start time := p_start;
  v_end time := p_end;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_dow IS NULL OR p_dow < 0 OR p_dow > 6 THEN RETURN false; END IF;
  IF p_hours IS NOT NULL AND jsonb_typeof(p_hours) = 'object' THEN
    v_day := p_hours -> (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[p_dow + 1];
    IF v_day IS NOT NULL THEN
      IF jsonb_typeof(v_day) = 'null' THEN RETURN false; END IF;
      v_open := v_day ->> 'open';
      v_close := v_day ->> 'close';
      IF v_open IS NOT NULL AND v_close IS NOT NULL THEN
        IF v_open !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
          OR v_close !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
          RETURN false;
        END IF;
        IF v_open::time > v_start THEN v_start := v_open::time; END IF;
        IF v_close::time < v_end THEN v_end := v_close::time; END IF;
      END IF;
    END IF;
  END IF;
  RETURN v_end > v_start;
END;
$$;
-- Same audience as staff_has_working_time (the search card view is security_invoker).
REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) TO anon, authenticated, service_role;

-- 2. 20261023080000 definition (the latest; no later migration replaces it) with each
--    working window also required to meet the shop's business hours on its weekday.
--    The hours are read through the staff member's facility with the caller's
--    rights, like the rest of this SECURITY INVOKER function; a facility the caller
--    cannot see reads as "no hours" (not gated), the same as get_available_slots.
CREATE OR REPLACE FUNCTION public.staff_has_working_time(p_staff_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles s
    LEFT JOIN public.facility_profiles f ON f.id = s.facility_id
    WHERE s.id = p_staff_id
      AND (
        EXISTS (
          SELECT 1 FROM public.staff_schedules ss
          WHERE ss.staff_id = s.id
            AND public.working_time_meets_business_hours(f.business_hours, ss.day_of_week, ss.start_time, ss.end_time)
        )
        OR EXISTS (
          SELECT 1 FROM public.schedule_overrides so
          WHERE so.staff_id = s.id
            AND so.date >= (pg_catalog.now() AT TIME ZONE 'Asia/Tokyo')::date
            AND so.is_holiday IS NOT TRUE
            AND so.start_time IS NOT NULL
            AND so.end_time IS NOT NULL
            AND public.working_time_meets_business_hours(f.business_hours, EXTRACT(DOW FROM so.date)::integer, so.start_time, so.end_time)
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;

-- 3. Copy of 20261023130100_manual_unassigned_booking_no_working_staff.sql; only the
--    BOOKING_NO_CAPABLE_STAFF branch (おまかせ without a free member) is added.
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
      -- 20261023130100: a manual (phone) booking without a nomination when no active
      -- staff member works the slot at all is not a double booking. Say so, so the
      -- shop picks a staff member (manual named bookings ignore shifts) or saves the
      -- shifts. Online bookings (p_enforce_schedule) keep BOOKING_CONFLICT.
      IF p_enforce_schedule IS NOT TRUE AND NOT EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = p_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
      ) THEN
        RAISE EXCEPTION 'BOOKING_NO_WORKING_STAFF: この時間に勤務予定のスタッフがいません';
      END IF;
      -- BOOKING_NO_CAPABLE_STAFF (20261023180000): someone works the slot, but nobody
      -- who works it handles every chosen menu (menu_staff). That is not a double
      -- booking, so do not say 「既に予約が入っています」.
      IF EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = p_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
      ) AND NOT EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = p_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_menu_ids) AS chosen(id)
            WHERE EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id)
              AND NOT EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id AND ms.staff_id = sp.id)
          )
      ) THEN
        RAISE EXCEPTION 'BOOKING_NO_CAPABLE_STAFF: 選択したメニューを担当できるスタッフがいません';
      END IF;
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
    total_price, points_used, status, points_base_price
  ) VALUES (
    p_facility_id, v_staff_id, p_staff_id IS NULL, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status,
    -- Visit points cap (20261023000100): the booking amount before points
    -- (menus + nomination fee - coupon). Only signed-in bookings earn points.
    CASE WHEN p_user_id IS NULL THEN NULL
      ELSE LEAST(GREATEST(COALESCE(p_total_price, 0), 0)::BIGINT + GREATEST(COALESCE(p_points_used, 0), 0), 2147483647)::INT END
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

-- 4. Copy of 20261023164100_customer_change_closes_with_free_cancel_window.sql; only the
--    lines marked BOOKING_NO_CAPABLE_STAFF are added (the menu list the assignment
--    already built inline is kept in v_chosen_menu_ids so the refusal reads the same list).
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
  -- BOOKING_NO_CAPABLE_STAFF (20261023180000): every booked menu, for the assignment and its refusal.
  v_chosen_menu_ids UUID[];
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
  -- 2026-10-23 (BOOKING_CHANGE_WINDOW_CLOSED): the shop's cancellation policy.
  v_cancel_rule TEXT;
  v_free_cancel_hours INT;
  v_late_cancel_rate INT;
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
  -- 2026-10-23 BOOKING_CHANGE_WINDOW_CLOSED (神原さん, option A): once the reservation's current start (JST)
  -- is inside the shop's free-cancellation window, the customer can no longer
  -- move it online (public path only; the shop's own changes are unaffected).
  -- Same rule as src/lib/cancel-fee.ts isPastFreeCancelWindow / computeCancelFee:
  -- free_window (or a NULL rule read from free_cancel_hours >= 1), a fee rate
  -- above 0 (NULL reads as 0), and start < now + free_cancel_hours (NULL reads
  -- as 24). FOR SHARE keeps the policy fixed until the change commits, as the
  -- cancel RPC does.
  IF p_enforce_schedule THEN
    SELECT p.cancel_rule, p.free_cancel_hours, p.late_cancel_rate
      INTO v_cancel_rule, v_free_cancel_hours, v_late_cancel_rate
    FROM public.facility_cancel_policies p
    WHERE p.facility_id = v_facility_id
    FOR SHARE;
    IF FOUND
      AND (v_cancel_rule IS NULL OR v_cancel_rule = 'free_window')
      AND COALESCE(v_free_cancel_hours, 24) > 0
      AND COALESCE(v_late_cancel_rate, 0) > 0
      AND (v_old_date + v_old_start) AT TIME ZONE 'Asia/Tokyo'
        < clock_timestamp() + make_interval(hours => COALESCE(v_free_cancel_hours, 24)) THEN
      RAISE EXCEPTION 'BOOKING_CHANGE_WINDOW_CLOSED: 無料キャンセルの期限を過ぎた予約は日時を変更できません';
    END IF;
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
    v_chosen_menu_ids := ARRAY(
      SELECT DISTINCT chosen.id
      FROM unnest(array_append(COALESCE(v_menu_ids, ARRAY[]::uuid[]), v_menu_id)) AS chosen(id)
      WHERE chosen.id IS NOT NULL
    );
    v_staff_id := public.booking_pick_free_staff(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes,
      v_chosen_menu_ids, p_booking_id, v_staff_id);

    IF v_staff_id IS NULL THEN
      -- BOOKING_NO_CAPABLE_STAFF (20261023180000): the same rule as a new おまかせ
      -- reservation. Someone works the new slot, but nobody who works it handles
      -- every booked menu (menu_staff): not a double booking.
      IF EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = v_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
      ) AND NOT EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = v_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_chosen_menu_ids) AS chosen(id)
            WHERE EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id)
              AND NOT EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id AND ms.staff_id = sp.id)
          )
      ) THEN
        RAISE EXCEPTION 'BOOKING_NO_CAPABLE_STAFF: 選択したメニューを担当できるスタッフがいません';
      END IF;
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
-- Preserve the mutation boundary: p_enforce_schedule=false is never public (grants as in 20261023070000).
REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;
