-- The reschedule page offers the times that overlap the reservation being moved
-- (2026-10-23).
--
-- Before: /mypage/bookings/[id]/change listed free times from
-- get_available_slots, which counted the reservation being moved as taking its
-- own time. A nominated reservation at 14:00-15:00 therefore hid 13:30, 14:00
-- and 14:30 (and more with a buffer), so moving it by 30-60 minutes was not
-- possible from the page, although change_booking_atomic (which leaves the
-- reservation itself out) accepts exactly those times. Same for an おまかせ
-- reservation when only one staff member handles its menus.
--
-- After:
--  * get_available_slots(uuid, uuid, date, integer, uuid) is the single body.
--    p_exclude_booking_id leaves that reservation out of the three places that
--    count reservations: the named staff overlap, the "needs any staff" check
--    and booking_unassigned_capacity_full (the same exclusion change_booking_atomic
--    applies). NULL excludes nothing. It has no default, so PostgREST resolves a
--    call with four named arguments to the four-argument function only.
--  * get_available_slots(uuid, uuid, date, integer) keeps its signature, owner,
--    SECURITY DEFINER, search_path and grants, and returns the five-argument
--    result with NULL (identical results). get_month_availability and every
--    current caller keep calling it.
--  * Only /api/slots/week passes the reservation, and only after checking that
--    the signed-in customer owns it, it belongs to the facility and can still be
--    changed (the time of someone else's reservation must not be inferable).
--
-- The body is the latest definition (20261022100000_booking_staff_assignment.sql,
-- not redefined since) with only the exclusion added. Both functions stay
-- server-only (20261020150500): EXECUTE for service_role, none for API roles.
--
-- Order: apply BEFORE deploying the application. The new reschedule page calls
-- the five-argument function through /api/slots/week; without this migration
-- that call fails and the page shows 「空き枠を取得できませんでした」. The current
-- application only calls the four-argument function, whose results do not change.
-- No data rewrite.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT,
  p_exclude_booking_id UUID
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week INT;
  v_work_start TIME;
  v_work_end TIME;
  v_is_holiday BOOLEAN;
  v_current_start TIME;
  v_current_end TIME;
  v_buffer_minutes INT;
  v_business_hours JSONB;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
  v_has_unassigned BOOLEAN;
  v_slot_free BOOLEAN;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN RETURN; END IF;
  IF NOT public.facility_booking_ready(p_facility_id) OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id AND is_active
  ) THEN RETURN; END IF;
  v_day_of_week := EXTRACT(DOW FROM p_date);

  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles
  WHERE id = p_facility_id;

  SELECT so.is_holiday, so.start_time, so.end_time
  INTO v_is_holiday, v_work_start, v_work_end
  FROM schedule_overrides so
  WHERE so.staff_id = p_staff_id AND so.date = p_date;

  IF FOUND AND v_is_holiday THEN
    RETURN;
  END IF;

  IF v_work_start IS NULL THEN
    SELECT ss.start_time, ss.end_time
    INTO v_work_start, v_work_end
    FROM staff_schedules ss
    WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_day_of_week;
  END IF;

  IF v_work_start IS NULL THEN
    RETURN;
  END IF;

  -- #2: 施設営業時間との交差。business_hours[曜日]=null は定休日→枠ゼロ。{open,close} は勤務窓をクランプ。
  -- キー不在・business_hours 未設定はゲートせず従来挙動（既存施設を壊さない）。
  IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
    v_day_key := CASE v_day_of_week
      WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
      WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
    v_day_val := v_business_hours -> v_day_key;
    IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
      IF jsonb_typeof(v_day_val) = 'null' THEN
        RETURN;                                   -- 定休日
      END IF;
      v_fac_open := (v_day_val ->> 'open')::time;
      v_fac_close := (v_day_val ->> 'close')::time;
      IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
        IF v_fac_open > v_work_start THEN v_work_start := v_fac_open; END IF;
        IF v_fac_close < v_work_end THEN v_work_end := v_fac_close; END IF;
      END IF;
    END IF;
  END IF;

  -- Only days with a reservation that needs any working staff (legacy without staff,
  -- or assigned to a member who no longer works it) pay for the capacity count per slot.
  v_has_unassigned := EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.facility_id = p_facility_id AND b.booking_date = p_date
      AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time)
  );

  v_current_start := v_work_start;
  -- TIME addition wraps at midnight. Compare remaining time before adding.
  WHILE v_current_start <= v_work_end
    AND v_work_end - v_current_start >= make_interval(mins => p_duration_minutes) LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    v_slot_free := NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
        AND b.id IS DISTINCT FROM p_exclude_booking_id
        AND (b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL)
        AND (b.end_time + (v_buffer_minutes || ' minutes')::INTERVAL > v_current_start)
    );
    IF v_slot_free AND v_has_unassigned THEN
      v_slot_free := NOT public.booking_unassigned_capacity_full(
        p_facility_id, p_date, v_current_start, v_current_end, v_buffer_minutes, p_exclude_booking_id);
    END IF;

    IF v_slot_free THEN
      slot_start := v_current_start;
      slot_end := v_current_end;
      RETURN NEXT;
    END IF;

    EXIT WHEN v_work_end - v_current_start < interval '30 minutes';
    v_current_start := v_current_start + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;
-- Availability reads stay server-only (20261020150500).
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer, uuid) TO service_role;

-- The existing entry point: the same slots, nothing excluded.
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT s.slot_start, s.slot_end
    FROM public.get_available_slots(p_facility_id, p_staff_id, p_date, p_duration_minutes, NULL::uuid) AS s;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) TO service_role;
