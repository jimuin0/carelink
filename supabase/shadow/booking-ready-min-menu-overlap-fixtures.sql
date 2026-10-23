-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023190000_booking_ready_min_menu_overlap.sql:
--   A staff member counts as able to take online bookings only when a working window leaves
--   at least the shop's shortest bookable menu inside the business hours of its weekday —
--   the same test get_available_slots applies before it opens a slot. Before, a window that
--   overlapped the hours by a few minutes made the search card read 「予約OK」 and passed
--   facility_booking_ready while every day was 満枠.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fe600000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_min(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking ready min menu overlap fixture failed: %', label; END IF; END $$;

-- Shape and audience: anon evaluates these through the security_invoker card view.
SELECT pg_temp.assert_min(
  has_function_privilege('anon', 'public.facility_shortest_booking_minutes(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.facility_shortest_booking_minutes(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.working_time_meets_business_hours(jsonb,integer,time,time,integer)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.working_time_meets_business_hours(jsonb,integer,time,time)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.staff_has_working_time(uuid)', 'EXECUTE'),
  'visitors can evaluate the working-time rule');
SELECT pg_temp.assert_min(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.facility_shortest_booking_minutes(uuid)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.working_time_meets_business_hours(jsonb,integer,time,time,integer)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.working_time_meets_business_hours(jsonb,integer,time,time)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.staff_has_working_time(uuid)'::regprocedure),
  'all stay SECURITY INVOKER');

-- The overlap must hold the given minutes (clamped to 15..480; NULL = 15), like get_available_slots.
SELECT pg_temp.assert_min(
  public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '09:00', '10:30', 30)
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '09:00', '10:30', 31)
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:00:01', '20:00', 60)
  AND public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:00', '20:00', 60)
  AND public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:45', '20:00', NULL)
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:50', '20:00', 5)
  AND public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '09:00', '18:00', 600)
  AND NOT public.working_time_meets_business_hours('{"mon":null}', 1, '10:00', '18:00', 15)
  AND NOT public.working_time_meets_business_hours(NULL, 1, '10:00', '09:00', 15),
  'the overlap must hold a whole slot of the given minutes');
-- The 4-argument form asks for 15 minutes (nothing shorter can be booked).
SELECT pg_temp.assert_min(
  public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:45', '20:00')
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '17:46', '20:00')
  AND public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '09:00', '10:30'),
  'the 4-argument form needs 15 minutes');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe600000-0000-4000-8000-000000000001', 'min-overlap-owner@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('fe610000-0000-4000-8000-000000000001', 'Min overlap clinic', 'min-overlap-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('fe600000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'owner');
-- Bookable: 60 minutes and unset (= 60, as the booking page reads it). A 15-minute draft does not count.
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('fe620000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Sixty', 3000, 60, true),
 ('fe620000-0000-4000-8000-000000000002', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Unset', 3000, NULL, NULL),
 ('fe620000-0000-4000-8000-000000000003', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Draft', 3000, 15, false);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fe630000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'Staff A', 'min-overlap-a', true, 1);
-- A works Mondays 07:00-10:30: only 30 minutes inside the 10:00-18:00 hours.
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('fe630000-0000-4000-8000-000000000001', 1, '07:00', '10:30');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('fe610000-0000-4000-8000-000000000001', 'https://example.invalid/min-overlap.jpg', 'other');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"10:00","close":"18:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'fe610000-0000-4000-8000-000000000001';

DO $$ BEGIN
  PERFORM pg_temp.assert_min(public.facility_shortest_booking_minutes('fe610000-0000-4000-8000-000000000001') = 60,
    'the shortest bookable menu is 60 minutes (unset = 60, drafts ignored)');
  PERFORM pg_temp.assert_min(public.facility_shortest_booking_minutes('fe610000-0000-4000-8000-0000000000ff') = 15,
    'a shop without bookable menus asks for 15 minutes');

  -- 1. A 30-minute overlap cannot hold a 60-minute menu: not bookable, and indeed no slot.
  PERFORM pg_temp.assert_min(NOT public.staff_has_working_time('fe630000-0000-4000-8000-000000000001'),
    'a 30-minute overlap is not working time for 60-minute menus');
  PERFORM pg_temp.assert_min(NOT public.facility_booking_ready('fe610000-0000-4000-8000-000000000001'),
    'the shop is not offered for online booking (before: ready, and 満枠 every day)');
  PERFORM pg_temp.assert_min((SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe610000-0000-4000-8000-000000000001') = 0,
    'the search card does not count A');

  -- A special day with a short overlap does not count either; one that holds the menu does.
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time)
    VALUES ('fe630000-0000-4000-8000-000000000001', '2030-01-14', false, '17:30', '20:00');  -- Monday, 30 minutes inside
  PERFORM pg_temp.assert_min(NOT public.facility_booking_ready('fe610000-0000-4000-8000-000000000001'),
    'a special day with a short overlap does not count');
  UPDATE public.schedule_overrides SET start_time = '17:00'
   WHERE staff_id = 'fe630000-0000-4000-8000-000000000001' AND date = '2030-01-14';
  PERFORM pg_temp.assert_min(public.facility_booking_ready('fe610000-0000-4000-8000-000000000001'),
    'a special day that holds the shortest menu counts');
  PERFORM pg_temp.assert_min(EXISTS (SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001',
      'fe630000-0000-4000-8000-000000000001', '2030-01-14', 60)),
    'and a 60-minute slot opens on it');
  DELETE FROM public.schedule_overrides WHERE staff_id = 'fe630000-0000-4000-8000-000000000001';

  -- 2. A 30-minute menu fits the 30-minute overlap: bookable, and get_available_slots agrees.
  INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
   ('fe620000-0000-4000-8000-000000000004', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Thirty', 2000, 30, true);
  PERFORM pg_temp.assert_min(public.facility_shortest_booking_minutes('fe610000-0000-4000-8000-000000000001') = 30,
    'the shortest bookable menu is now 30 minutes');
  PERFORM pg_temp.assert_min(public.staff_has_working_time('fe630000-0000-4000-8000-000000000001')
    AND public.facility_booking_ready('fe610000-0000-4000-8000-000000000001')
    AND (SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe610000-0000-4000-8000-000000000001') = 1,
    'a 30-minute overlap makes the shop bookable for a 30-minute menu');
  PERFORM pg_temp.assert_min(EXISTS (SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001',
      'fe630000-0000-4000-8000-000000000001', '2030-01-07', 30) s WHERE s.slot_start = '10:00' AND s.slot_end = '10:30'),
    'and get_available_slots opens the 10:00-10:30 slot');
  PERFORM pg_temp.assert_min(NOT EXISTS (SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001',
      'fe630000-0000-4000-8000-000000000001', '2030-01-07', 60)),
    'while no 60-minute slot opens (the 60-minute menus stay unbookable on Mondays)');

  -- 3. Normal shifts (the 3 published production shops) are unaffected.
  DELETE FROM public.facility_menus WHERE id = 'fe620000-0000-4000-8000-000000000004';
  UPDATE public.staff_schedules SET start_time = '09:00', end_time = '17:00'
   WHERE staff_id = 'fe630000-0000-4000-8000-000000000001' AND day_of_week = 1;
  PERFORM pg_temp.assert_min(public.facility_booking_ready('fe610000-0000-4000-8000-000000000001'),
    'a normal shift inside the hours stays bookable');
END $$;

-- Visitors read the same through the security_invoker card view (published menus only).
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM pg_temp.assert_min(public.facility_shortest_booking_minutes('fe610000-0000-4000-8000-000000000001') = 60,
    'anonymous visitors see the same shortest menu');
  PERFORM pg_temp.assert_min((SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe610000-0000-4000-8000-000000000001') = 1,
    'anonymous card counts A');
  PERFORM pg_temp.assert_min(public.facility_booking_ready('fe610000-0000-4000-8000-000000000001'), 'anonymous readiness agrees');
END $$;
RESET ROLE;

-- Back to the short Monday window: anonymous visitors also stop counting A.
UPDATE public.staff_schedules SET start_time = '07:00', end_time = '10:30'
 WHERE staff_id = 'fe630000-0000-4000-8000-000000000001' AND day_of_week = 1;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM pg_temp.assert_min((SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe610000-0000-4000-8000-000000000001') = 0,
    'anonymous card does not count a short overlap');
END $$;
RESET ROLE;

SELECT 'booking readiness needs the shortest bookable menu inside business hours';
ROLLBACK;
