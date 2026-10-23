-- A staff member counts as able to take online bookings only when a working window leaves
-- at least the shop's shortest bookable menu inside the business hours (2026-10-23).
--
-- 【予約OK なのに毎日 満枠（短い重なり）】20261023180000 made public.staff_has_working_time
--   require a working window to leave SOME time inside the business hours of its weekday
--   (public.working_time_meets_business_hours: end > start after clamping). A window that
--   overlaps the hours by only a few minutes (e.g. hours 10:00-19:00, staff 07:00-10:05)
--   still passed, while get_available_slots opens a slot only when the clamped window is at
--   least the requested duration long — and the booking page requests at least the shortest
--   menu (bookingDurationForMenus: duration_minutes, null/0 = 60, clamped to 15..480). Such a
--   shop showed 「予約OK」 on its search card and passed the readiness gate while its calendar
--   read 満枠 on every day.
--
-- What changes:
--   * public.facility_shortest_booking_minutes(uuid) (new): the shortest duration the booking
--     page can request at the shop = min over its bookable menus (is_published IS DISTINCT
--     FROM false, the same menus facility_booking_ready counts) of
--     least(greatest(coalesce(nullif(duration_minutes, 0), 60), 15), 480); 15 (the shortest
--     duration get_available_slots accepts) when the shop has no bookable menu. SECURITY
--     INVOKER like its callers; anon sees exactly the published menus of published shops
--     ("Public read menus"), which are the menus that matter for the card.
--   * public.working_time_meets_business_hours(jsonb, integer, time, time, integer) (new
--     overload): the 20261023180000 body with the final test changed from end > start to
--     end - start >= the given minutes (clamped to 15..480; NULL = 15) — the same test as
--     get_available_slots' loop (v_work_end - v_current_start >= make_interval(mins => d)).
--   * public.working_time_meets_business_hours(jsonb, integer, time, time) keeps its
--     signature, argument names, SECURITY INVOKER, search_path and grants, and now delegates
--     with 15 minutes (nothing shorter can ever be booked). Its only SQL caller was
--     staff_has_working_time.
--   * public.staff_has_working_time(uuid): the 20261023180000 body with each window tested
--     against the shop's shortest bookable menu. Signature, SECURITY INVOKER, search_path and
--     grants unchanged.
--   facility_booking_ready and facility_card_view call staff_has_working_time and are NOT
--   redefined: their bodies, column list and order, grants and comments are unchanged.
--   get_available_slots is NOT changed (its semantics are the reference this rule follows).
--   App mirror: workingTimeMeetsBusinessHours / shortestBookingMinutes / summarizeWorkingStaff
--   (src/lib/facility-publish-gate.ts).
--
-- Production (2026-10-23, per the task brief; not verified from here): the 3 published
--   facilities have normal shifts that overlap their hours by hours, not minutes, so none of
--   them should stop being bookable. BEFORE APPLYING, run
--   scripts/diagnose-booking-ready-hours-overlap.sql (SELECT only, updated to this rule) in
--   the CareLink production SQL Editor (project ref xzafxiupbflvgbarrihe) and apply only when
--   「適用後に予約を受けられなくなる店舗」 is 0 (or the listed shops have been told to fix their
--   hours / shifts — their calendars are already 満枠 every day).
--
-- Apply order: after every migration up to 20261023180000_booking_ready_hours_overlap_and_capable_staff.sql.
-- Safe before or after deploying the application: no error code, RPC or column is added or
-- removed for the app (the app never calls these functions; it mirrors the rule). If the app
-- is deployed first, its page-level readiness is already the new rule, so for a shop whose
-- staff overlap the hours by less than its shortest menu the search card can still read
-- 「予約OK」 while the page says ネット予約は準備中 (the calendar was 満枠 anyway) until this is
-- applied. Applied first, the card drops 「予約OK」 while the page may still render the
-- calendar, which is 満枠 because get_available_slots calls facility_booking_ready.
-- No data rewrite. Verified in a disposable DB by supabase/shadow/booking-ready-min-menu-overlap-fixtures.sql.

DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.facility_menus') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- 1. The shortest duration the booking page can request at the shop (bookingDurationForMenus
--    of a single menu, minimum over the bookable menus; 15 when there is none).
CREATE OR REPLACE FUNCTION public.facility_shortest_booking_minutes(p_facility_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(
    min(least(greatest(coalesce(nullif(m.duration_minutes, 0), 60), 15), 480))::integer,
    15)
  FROM public.facility_menus m
  WHERE m.facility_id = p_facility_id
    AND m.is_published IS DISTINCT FROM false;
$$;
REVOKE ALL ON FUNCTION public.facility_shortest_booking_minutes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facility_shortest_booking_minutes(uuid) TO anon, authenticated, service_role;

-- 2. 20261023180000 body (the latest) with the window required to leave at least
--    p_min_minutes inside the business hours.
CREATE OR REPLACE FUNCTION public.working_time_meets_business_hours(
  p_hours jsonb, p_dow integer, p_start time, p_end time, p_min_minutes integer
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_day jsonb;
  v_open text;
  v_close text;
  v_start time := p_start;
  v_end time := p_end;
  v_need integer := least(greatest(coalesce(p_min_minutes, 15), 15), 480);
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
  -- Same test as get_available_slots: the (clamped) window must hold a whole slot.
  RETURN v_end > v_start AND v_end - v_start >= make_interval(mins => v_need);
END;
$$;
REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time,integer) TO anon, authenticated, service_role;

-- 3. The 4-argument form keeps its signature and grants and asks for the shortest duration
--    any booking can have (15 minutes).
CREATE OR REPLACE FUNCTION public.working_time_meets_business_hours(
  p_hours jsonb, p_dow integer, p_start time, p_end time
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RETURN public.working_time_meets_business_hours(p_hours, p_dow, p_start, p_end, 15);
END;
$$;
REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) TO anon, authenticated, service_role;

-- 4. 20261023180000 definition (the latest; no later migration replaces it) with each window
--    tested against the shop's shortest bookable menu.
CREATE OR REPLACE FUNCTION public.staff_has_working_time(p_staff_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles s
    LEFT JOIN public.facility_profiles f ON f.id = s.facility_id
    CROSS JOIN LATERAL (SELECT public.facility_shortest_booking_minutes(s.facility_id) AS minutes) need
    WHERE s.id = p_staff_id
      AND (
        EXISTS (
          SELECT 1 FROM public.staff_schedules ss
          WHERE ss.staff_id = s.id
            AND public.working_time_meets_business_hours(f.business_hours, ss.day_of_week, ss.start_time, ss.end_time, need.minutes)
        )
        OR EXISTS (
          SELECT 1 FROM public.schedule_overrides so
          WHERE so.staff_id = s.id
            AND so.date >= (pg_catalog.now() AT TIME ZONE 'Asia/Tokyo')::date
            AND so.is_holiday IS NOT TRUE
            AND so.start_time IS NOT NULL
            AND so.end_time IS NOT NULL
            AND public.working_time_meets_business_hours(f.business_hours, EXTRACT(DOW FROM so.date)::integer, so.start_time, so.end_time, need.minutes)
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;
