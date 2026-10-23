-- A customer can no longer change the date/time of a reservation online once
-- it is past the shop's free-cancellation deadline (2026-10-23).
--
-- 神原さん (2026-10-23, option A): past the free-cancellation deadline the
-- customer contacts the shop to change the date/time.
--
-- Before: with a 「N時間前まで無料」 policy (cancel_rule 'free_window', or a
-- NULL rule read from free_cancel_hours >= 1) a customer past the window could
-- move the reservation days ahead from /mypage/bookings/[id]/change and then
-- cancel it. The cancel RPC computes the fee from the reservation's current
-- (new) date/time, so the fee became 0 and the original slot was freed at the
-- last minute.
--
-- After: change_booking_atomic raises BOOKING_CHANGE_WINDOW_CLOSED on the
-- public path only (p_enforce_schedule = true; the shop's manual changes pass
-- false and are unchanged) when the reservation's CURRENT start (JST) is
-- inside the free window. The rule is the one the fee uses
-- (src/lib/cancel-fee.ts isPastFreeCancelWindow / computeCancelFee):
--   * free_window / NULL rule with free_cancel_hours > 0 (NULL reads as 24)
--   * late_cancel_rate > 0 (NULL reads as 0: no fee, nothing to avoid)
--   * start < now + free_cancel_hours
-- always_fee is not affected (a fee applies whenever the reservation is
-- cancelled, so moving it does not avoid one); no_online is not affected
-- (online cancellation is refused anyway). Shops without a policy row are not
-- affected (no fee). /api/booking/[id]/change checks the same rule first.
--
-- The function is a copy of its latest definition
-- (20261023070000_booking_start_must_be_future.sql; no later migration or DO
-- block redefines it) with only the lines marked "BOOKING_CHANGE_WINDOW_CLOSED"
-- added. Signature, SECURITY DEFINER and search_path are unchanged; REVOKE /
-- GRANT are restated.
--
-- Order: safe to apply before or after the application deploy. Only customer
-- changes inside the free window are refused; until the new application
-- (which maps the code to 「…店舗へ直接ご連絡ください」) is deployed, the current
-- application shows them as 「変更に失敗しました」. The new application checks the
-- same rule before calling the RPC, so it does not depend on this migration.
-- No data rewrite.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

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
-- Preserve the mutation boundary: p_enforce_schedule=false is never public (grants as in 20261023070000).
REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;
