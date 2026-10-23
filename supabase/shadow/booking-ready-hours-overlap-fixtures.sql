-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023180000_booking_ready_hours_overlap_and_capable_staff.sql:
--   1. A staff member counts as able to take online bookings only when a working window
--      (weekly row, or an upcoming working special day) leaves time inside the shop's
--      business hours on its weekday (get_available_slots clamps to the hours and opens
--      nothing on a closed day). Before, a shop whose staff worked only outside its hours
--      passed facility_booking_ready and its search card read 「予約OK」 while every day
--      was 満枠.
--   2. 指名なし with someone working the slot but nobody who works it able to handle the
--      chosen menus (menu_staff) is refused as BOOKING_NO_CAPABLE_STAFF, not BOOKING_CONFLICT
--      「この時間帯は既に予約が入っています」, on create (online and manual) and on a change.
--      No working staff at all and busy capable staff keep their codes.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fe500000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_overlap(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking ready hours overlap fixture failed: %', label; END IF; END $$;

-- Function shape and audience: anon evaluates it through the security_invoker card view.
SELECT pg_temp.assert_overlap(has_function_privilege('anon', 'public.working_time_meets_business_hours(jsonb,integer,time,time)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.working_time_meets_business_hours(jsonb,integer,time,time)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.staff_has_working_time(uuid)', 'EXECUTE'),
  'visitors can evaluate the working-time rule');
SELECT pg_temp.assert_overlap(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.staff_has_working_time(uuid)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.working_time_meets_business_hours(jsonb,integer,time,time)'::regprocedure),
  'both stay SECURITY INVOKER');
SELECT pg_temp.assert_overlap(NOT has_function_privilege('anon', 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])'::regprocedure)
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)'::regprocedure),
  'the booking functions stay server-only SECURITY DEFINER');

-- The reading of business_hours (same as get_available_slots; unreadable times open nothing, never raise).
SELECT pg_temp.assert_overlap(
  public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '09:00', '10:30')
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '07:00', '10:00')
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":"18:00"}}', 1, '18:00', '21:00')
  AND NOT public.working_time_meets_business_hours('{"mon":null}', 1, '10:00', '18:00')
  AND public.working_time_meets_business_hours('{"tue":null}', 1, '07:00', '08:00')
  AND public.working_time_meets_business_hours(NULL, 1, '07:00', '08:00')
  AND public.working_time_meets_business_hours('[]', 1, '07:00', '08:00')
  AND public.working_time_meets_business_hours('{"mon":"always"}', 1, '07:00', '08:00')
  AND public.working_time_meets_business_hours('{"mon":{"open":"10:00"}}', 1, '07:00', '08:00')
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"25:00","close":"18:00"}}', 1, '10:00', '11:00')
  AND NOT public.working_time_meets_business_hours('{"mon":{"open":"10:00","close":18}}', 1, '10:00', '11:00')
  AND NOT public.working_time_meets_business_hours(NULL, 7, '10:00', '11:00')
  AND NOT public.working_time_meets_business_hours(NULL, 1, NULL, '11:00')
  AND NOT public.working_time_meets_business_hours(NULL, 1, '10:00', '10:00'),
  'business_hours is read like get_available_slots');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe500000-0000-4000-8000-000000000001', 'overlap-owner@example.invalid', now()),
 ('fe500000-0000-4000-8000-000000000002', 'overlap-customer@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('fe510000-0000-4000-8000-000000000001', 'Overlap clinic', 'overlap-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('fe500000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'owner');
-- M1: anyone. M2: only staff B (menu_staff).
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('fe520000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'synthetic', 'Anyone menu', 3000, 60, true),
 ('fe520000-0000-4000-8000-000000000002', 'fe510000-0000-4000-8000-000000000001', 'synthetic', 'B only menu', 5000, 60, true);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fe530000-0000-4000-8000-000000000001', 'fe510000-0000-4000-8000-000000000001', 'Staff A', 'overlap-a', true, 1);
-- A works Wednesdays (the shop is closed) and Mondays 07:00-10:00 (ends when the shop opens).
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('fe530000-0000-4000-8000-000000000001', 3, '10:00', '18:00'),
 ('fe530000-0000-4000-8000-000000000001', 1, '07:00', '10:00');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('fe510000-0000-4000-8000-000000000001', 'https://example.invalid/overlap.jpg', 'other');
-- Open Mon/Tue 10:00-18:00, closed the rest (confirmed: every day saved).
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"10:00","close":"18:00"},"tue":{"open":"10:00","close":"18:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'fe510000-0000-4000-8000-000000000001';

-- 1. Working time only outside the business hours does not make the shop bookable.
DO $$ BEGIN
  PERFORM pg_temp.assert_overlap(public.confirmed_booking_hours((SELECT business_hours FROM public.facility_profiles WHERE id = 'fe510000-0000-4000-8000-000000000001')),
    'the hours are confirmed (only the staff condition is missing)');
  PERFORM pg_temp.assert_overlap(NOT public.staff_has_working_time('fe530000-0000-4000-8000-000000000001'),
    'a closed weekday and a window ending at opening time are not working time');
  PERFORM pg_temp.assert_overlap(NOT public.facility_booking_ready('fe510000-0000-4000-8000-000000000001'),
    'the shop is not offered for online booking (before: ready, and 満枠 every day)');
  PERFORM pg_temp.assert_overlap((SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe510000-0000-4000-8000-000000000001') = 0,
    'the search card does not count A');
  PERFORM pg_temp.assert_overlap(NOT EXISTS (SELECT 1 FROM public.get_available_slots('fe510000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', '2030-01-07', 30)),
    'and indeed no slot opens on a Monday');

  -- An upcoming special day outside the hours does not count; one inside does.
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time) VALUES
    ('fe530000-0000-4000-8000-000000000001', '2030-01-09', false, '10:00', '18:00'),  -- Wednesday: closed
    ('fe530000-0000-4000-8000-000000000001', '2030-01-07', false, '18:00', '20:00');  -- Monday after closing
  PERFORM pg_temp.assert_overlap(NOT public.facility_booking_ready('fe510000-0000-4000-8000-000000000001'),
    'special days outside the hours do not count');
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time)
    VALUES ('fe530000-0000-4000-8000-000000000001', '2030-01-08', false, '17:00', '19:00');  -- Tuesday 17:00-18:00 inside
  PERFORM pg_temp.assert_overlap(public.facility_booking_ready('fe510000-0000-4000-8000-000000000001'),
    'an upcoming special day that meets the hours counts');
  PERFORM pg_temp.assert_overlap(EXISTS (SELECT 1 FROM public.get_available_slots('fe510000-0000-4000-8000-000000000001', 'fe530000-0000-4000-8000-000000000001', '2030-01-08', 30)),
    'and a slot opens on it');
  DELETE FROM public.schedule_overrides WHERE staff_id = 'fe530000-0000-4000-8000-000000000001';

  -- A weekly window that overlaps the hours counts (the 3 published production shops are like this).
  UPDATE public.staff_schedules SET start_time = '09:00', end_time = '17:00'
   WHERE staff_id = 'fe530000-0000-4000-8000-000000000001' AND day_of_week = 1;
  PERFORM pg_temp.assert_overlap(public.staff_has_working_time('fe530000-0000-4000-8000-000000000001')
    AND public.facility_booking_ready('fe510000-0000-4000-8000-000000000001')
    AND (SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe510000-0000-4000-8000-000000000001') = 1,
    'a weekly window inside the hours makes the shop bookable');
END $$;

-- Visitors read the same through the security_invoker card view.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM pg_temp.assert_overlap((SELECT active_staff_count FROM public.facility_card_view WHERE id = 'fe510000-0000-4000-8000-000000000001') = 1,
    'anonymous card counts A');
  PERFORM pg_temp.assert_overlap(public.facility_booking_ready('fe510000-0000-4000-8000-000000000001'), 'anonymous readiness agrees');
END $$;
RESET ROLE;

-- 2. 指名なし and menu_staff. B works Mondays 09:00-17:00 and is the only one for M2.
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fe530000-0000-4000-8000-000000000002', 'fe510000-0000-4000-8000-000000000001', 'Staff B', 'overlap-b', true, 2);
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time)
 VALUES ('fe530000-0000-4000-8000-000000000002', 1, '09:00', '17:00');
INSERT INTO public.menu_staff(menu_id, staff_id)
 VALUES ('fe520000-0000-4000-8000-000000000002', 'fe530000-0000-4000-8000-000000000002');
-- B is off on Monday 2030-01-14; A works then.
INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time)
 VALUES ('fe530000-0000-4000-8000-000000000002', '2030-01-14', true, NULL, NULL);

-- The board's phone booking, as POST /api/admin/bookings calls it.
CREATE FUNCTION pg_temp.manual(p_op int, p_menu uuid, p_date text, p_start text, p_end text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  result := public.create_manual_booking_atomic('fe500000-0000-4000-8000-000000000001',
    ('fe540000-0000-4000-8000-' || lpad(p_op::text, 12, '0'))::uuid,
    jsonb_build_object('facility_id', 'fe510000-0000-4000-8000-000000000001', 'staff_id', NULL,
      'menu_ids', jsonb_build_array(p_menu), 'booking_date', p_date,
      'start_time', p_start, 'end_time', p_end, 'customer_name', 'Synthetic phone', 'email', NULL, 'phone', NULL, 'note', NULL));
  RETURN result->>'booking_id';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
-- The online core (schedule gate on), as the receipt gateway calls it.
CREATE FUNCTION pg_temp.online(p_user uuid, p_menu uuid, p_date date, p_start time, p_end time) RETURNS text LANGUAGE plpgsql AS $$
DECLARE booking_id uuid;
BEGIN
  booking_id := public.create_booking_for_menus_atomic('fe510000-0000-4000-8000-000000000001', NULL, p_user,
    p_menu, NULL, p_date, p_start, p_end, 'Synthetic online', 'overlap-customer@example.invalid',
    NULL, NULL, 3000, 0, 'pending', true, ARRAY[p_menu]);
  RETURN booking_id::text;
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.change(p_booking text, p_date date, p_start time, p_end time, p_enforce boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.change_booking_atomic(p_booking::uuid, 'fe500000-0000-4000-8000-000000000002', p_date, p_start, p_end, p_enforce);
  RETURN 'changed';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE outcome text; first_m2 text; moved text;
BEGIN
  -- Monday 2030-01-07: B works and handles M2, so 指名なし M2 goes to B.
  first_m2 := pg_temp.online('fe500000-0000-4000-8000-000000000002', 'fe520000-0000-4000-8000-000000000002', '2030-01-07', '10:00', '11:00');
  PERFORM pg_temp.assert_overlap((SELECT staff_id FROM public.bookings WHERE id = first_m2::uuid) = 'fe530000-0000-4000-8000-000000000002'
    AND (SELECT staff_auto_assigned FROM public.bookings WHERE id = first_m2::uuid), '指名なし M2 is assigned to B (got ' || first_m2 || ')');
  -- B is now busy at 10:00. A works but cannot do M2: the capable member is busy, a real conflict.
  outcome := pg_temp.online(NULL, 'fe520000-0000-4000-8000-000000000002', '2030-01-07', '10:00', '11:00');
  PERFORM pg_temp.assert_overlap(outcome = 'BOOKING_CONFLICT', 'capable B busy is still BOOKING_CONFLICT (got ' || outcome || ')');

  -- Monday 2030-01-14: B is off, A works but cannot do M2. Not a double booking.
  outcome := pg_temp.online(NULL, 'fe520000-0000-4000-8000-000000000002', '2030-01-14', '10:00', '11:00');
  PERFORM pg_temp.assert_overlap(outcome = 'BOOKING_NO_CAPABLE_STAFF', 'online 指名なし M2 without a capable member (before: BOOKING_CONFLICT; got ' || outcome || ')');
  outcome := pg_temp.manual(1, 'fe520000-0000-4000-8000-000000000002', '2030-01-14', '11:00', '12:00');
  PERFORM pg_temp.assert_overlap(outcome = 'BOOKING_NO_CAPABLE_STAFF', 'manual 指名なし M2 without a capable member (got ' || outcome || ')');
  PERFORM pg_temp.assert_overlap(NOT EXISTS (SELECT 1 FROM public.manual_booking_operations WHERE operation_id = 'fe540000-0000-4000-8000-000000000001'),
    'the refused phone booking is not stored');
  -- M1 (anyone) at the same time goes to A as before.
  outcome := pg_temp.manual(2, 'fe520000-0000-4000-8000-000000000001', '2030-01-14', '11:00', '12:00');
  PERFORM pg_temp.assert_overlap((SELECT staff_id FROM public.bookings WHERE id = outcome::uuid) = 'fe530000-0000-4000-8000-000000000001',
    '指名なし M1 still goes to A (got ' || outcome || ')');

  -- Tuesday 2030-01-08: nobody works. Codes unchanged.
  outcome := pg_temp.online(NULL, 'fe520000-0000-4000-8000-000000000002', '2030-01-08', '10:00', '11:00');
  PERFORM pg_temp.assert_overlap(outcome = 'BOOKING_CONFLICT', 'online without any working member keeps BOOKING_CONFLICT (got ' || outcome || ')');
  outcome := pg_temp.manual(3, 'fe520000-0000-4000-8000-000000000002', '2030-01-08', '10:00', '11:00');
  PERFORM pg_temp.assert_overlap(outcome = 'BOOKING_NO_WORKING_STAFF', 'manual without any working member keeps BOOKING_NO_WORKING_STAFF (got ' || outcome || ')');

  -- Moving the M2 reservation to 2030-01-14 (B off, A cannot do M2): the same accurate refusal,
  -- on the customer path and on the shop's path; the reservation is not moved.
  moved := pg_temp.change(first_m2, '2030-01-14', '13:00', '14:00', true);
  PERFORM pg_temp.assert_overlap(moved = 'BOOKING_NO_CAPABLE_STAFF', 'customer change without a capable member (got ' || moved || ')');
  moved := pg_temp.change(first_m2, '2030-01-14', '13:00', '14:00', false);
  PERFORM pg_temp.assert_overlap(moved = 'BOOKING_NO_CAPABLE_STAFF', 'shop change without a capable member (got ' || moved || ')');
  PERFORM pg_temp.assert_overlap((SELECT booking_date FROM public.bookings WHERE id = first_m2::uuid) = '2030-01-07',
    'the refused change left the reservation where it was');
  -- Moving it within Monday 2030-01-07 still keeps B (capable and free).
  moved := pg_temp.change(first_m2, '2030-01-07', '14:00', '15:00', true);
  PERFORM pg_temp.assert_overlap(moved = 'changed'
    AND (SELECT staff_id FROM public.bookings WHERE id = first_m2::uuid) = 'fe530000-0000-4000-8000-000000000002',
    'a change to a time B works is accepted and stays with B (got ' || moved || ')');
END $$;
RESET ROLE;

SELECT 'booking readiness needs working time inside business hours; 指名なし without a capable member is refused accurately';
ROLLBACK;
