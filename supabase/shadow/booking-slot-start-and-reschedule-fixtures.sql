-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023070000: a reservation cannot be made for, or moved to, a time whose
-- start (JST) has passed (public paths only).
-- 20261023070100: the reschedule availability can leave out the reservation being
-- moved; the existing four-argument entry point returns the same slots as before.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_slot(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'slot start / reschedule fixture failed: %', label; END IF; END $$;

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('bc100000-0000-4000-8000-000000000001', 'slot-customer@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('bc110000-0000-4000-8000-000000000001', 'Slot clinic', 'slot-start-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('bc120000-0000-4000-8000-000000000001', 'bc110000-0000-4000-8000-000000000001', 'synthetic', 'Open menu', 500, 60, true);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('bc130000-0000-4000-8000-000000000001', 'bc110000-0000-4000-8000-000000000001', 'Staff A', 'slot-start-a', true, 1);
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('bc130000-0000-4000-8000-000000000001', 1, '09:00', '17:00');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('bc110000-0000-4000-8000-000000000001', 'https://example.invalid/slot-start.jpg', 'other');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'bc110000-0000-4000-8000-000000000001';

-- The customer's nominated reservation on 2030-01-07 (Monday) 14:00-15:00, and a legacy
-- reservation without staff on 2030-01-14 (Monday) 10:00-11:00.
INSERT INTO public.bookings(id, facility_id, staff_id, user_id, menu_id, booking_date, start_time, end_time, customer_name, email, status) VALUES
 ('bc140000-0000-4000-8000-000000000001', 'bc110000-0000-4000-8000-000000000001', 'bc130000-0000-4000-8000-000000000001',
  'bc100000-0000-4000-8000-000000000001', 'bc120000-0000-4000-8000-000000000001', '2030-01-07', '14:00', '15:00', 'Customer',
  'slot-customer@example.invalid', 'confirmed'),
 ('bc140000-0000-4000-8000-000000000002', 'bc110000-0000-4000-8000-000000000001', NULL, NULL,
  'bc120000-0000-4000-8000-000000000001', '2030-01-14', '10:00', '11:00', 'Legacy', 'legacy@example.invalid', 'confirmed');

CREATE FUNCTION pg_temp.slots_excluding(p_date date, p_exclude uuid) RETURNS time[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(s.slot_start ORDER BY s.slot_start), ARRAY[]::time[])
  FROM public.get_available_slots('bc110000-0000-4000-8000-000000000001', 'bc130000-0000-4000-8000-000000000001', p_date, 60, p_exclude) s;
$$;
CREATE FUNCTION pg_temp.slots_four(p_date date) RETURNS time[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(s.slot_start ORDER BY s.slot_start), ARRAY[]::time[])
  FROM public.get_available_slots('bc110000-0000-4000-8000-000000000001', 'bc130000-0000-4000-8000-000000000001', p_date, 60) s;
$$;

-- 1. Reschedule availability (20261023070100).
DO $$ BEGIN
  PERFORM pg_temp.assert_slot(public.facility_booking_ready('bc110000-0000-4000-8000-000000000001'), 'synthetic facility accepts online bookings');
  -- Regression: the reservation hid the times overlapping itself, so 30-60 minute moves were not offered.
  PERFORM pg_temp.assert_slot(NOT (pg_temp.slots_four('2030-01-07') && ARRAY['13:30','14:00','14:30']::time[]),
    'the four-argument entry point still treats the reservation as taking its time');
  PERFORM pg_temp.assert_slot(pg_temp.slots_excluding('2030-01-07', 'bc140000-0000-4000-8000-000000000001') @> ARRAY['13:30','14:00','14:30']::time[],
    'leaving the moved reservation out offers the times overlapping it');
  PERFORM pg_temp.assert_slot(pg_temp.slots_excluding('2030-01-07', NULL) = pg_temp.slots_four('2030-01-07'),
    'NULL excludes nothing (same slots as the four-argument entry point)');
  PERFORM pg_temp.assert_slot(pg_temp.slots_excluding('2030-01-07', 'bc140000-0000-4000-8000-0000000000ff') = pg_temp.slots_four('2030-01-07'),
    'an unrelated reservation id excludes nothing');
  PERFORM pg_temp.assert_slot(cardinality(pg_temp.slots_four('2030-01-07')) = 12,
    'the four-argument entry point returns the full day minus the three overlapping starts (09:00-16:00 every 30 minutes)');
END $$;

-- With a 15-minute buffer the neighbouring starts are hidden too, and come back when excluded.
UPDATE public.facility_profiles SET booking_buffer_minutes = 15 WHERE id = 'bc110000-0000-4000-8000-000000000001';
DO $$ BEGIN
  PERFORM pg_temp.assert_slot(NOT (pg_temp.slots_four('2030-01-07') && ARRAY['13:00','15:00']::time[]),
    'the buffer hides 13:00 and 15:00 around the reservation');
  PERFORM pg_temp.assert_slot(pg_temp.slots_excluding('2030-01-07', 'bc140000-0000-4000-8000-000000000001') @> ARRAY['13:00','13:30','14:00','14:30','15:00']::time[],
    'leaving the reservation out also lifts its buffer');
END $$;
UPDATE public.facility_profiles SET booking_buffer_minutes = 0 WHERE id = 'bc110000-0000-4000-8000-000000000001';

-- A legacy reservation without staff fills the single working member's capacity; it is the
-- reservation being moved only when it is the one excluded (the capacity count leaves it out).
DO $$ BEGIN
  PERFORM pg_temp.assert_slot(NOT ('10:00'::time = ANY (pg_temp.slots_four('2030-01-14'))), 'legacy capacity hides 10:00');
  PERFORM pg_temp.assert_slot('10:00'::time = ANY (pg_temp.slots_excluding('2030-01-14', 'bc140000-0000-4000-8000-000000000002')),
    'excluding the legacy reservation frees its capacity');
  PERFORM pg_temp.assert_slot(NOT ('10:00'::time = ANY (pg_temp.slots_excluding('2030-01-14', 'bc140000-0000-4000-8000-000000000001'))),
    'excluding another reservation keeps the legacy capacity');
END $$;

-- The change RPC accepts the time the page now offers (it always left the reservation out).
DO $$ BEGIN
  PERFORM public.change_booking_atomic('bc140000-0000-4000-8000-000000000001', 'bc100000-0000-4000-8000-000000000001', '2030-01-07', '14:30', '15:30', true);
  PERFORM pg_temp.assert_slot((SELECT start_time = '14:30' FROM public.bookings WHERE id = 'bc140000-0000-4000-8000-000000000001'),
    'a 30-minute move of a nominated reservation is accepted');
END $$;

-- 2. A time whose start (JST) has passed (20261023070000).
CREATE FUNCTION pg_temp.jst_now() RETURNS timestamp LANGUAGE sql AS $$ SELECT clock_timestamp() AT TIME ZONE 'Asia/Tokyo' $$;
CREATE FUNCTION pg_temp.create_outcome(p_date date, p_start time, p_end time) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_online_booking_atomic('bc110000-0000-4000-8000-000000000001', 'bc130000-0000-4000-8000-000000000001', NULL,
    'bc120000-0000-4000-8000-000000000001', NULL, p_date, p_start, p_end, 'Synthetic', 'slot@example.invalid', NULL, NULL, 0, 0, 'pending',
    ARRAY['bc120000-0000-4000-8000-000000000001'::uuid]);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.change_outcome(p_date date, p_start time, p_end time, p_enforce boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.change_booking_atomic('bc140000-0000-4000-8000-000000000001', 'bc100000-0000-4000-8000-000000000001',
    p_date, p_start, p_end, p_enforce);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
DO $$ DECLARE a_minute_ago timestamp := pg_temp.jst_now() - interval '1 minute';
BEGIN
  -- Regression: a slot of today whose start had passed was created (and then could not be cancelled or changed online).
  PERFORM pg_temp.assert_slot(pg_temp.create_outcome(a_minute_ago::date, a_minute_ago::time, (a_minute_ago + interval '60 minutes')::time) = 'BOOKING_SLOT_PASSED',
    'a slot that started a minute ago is refused');
  PERFORM pg_temp.assert_slot(pg_temp.create_outcome((pg_temp.jst_now() - interval '1 day')::date, '10:00', '11:00') = 'BOOKING_SLOT_PASSED',
    'a slot of yesterday is refused');
  PERFORM pg_temp.assert_slot(NOT EXISTS (SELECT 1 FROM public.bookings WHERE facility_id = 'bc110000-0000-4000-8000-000000000001'
    AND customer_name = 'Synthetic'), 'no refused reservation is stored');
  PERFORM pg_temp.assert_slot(pg_temp.create_outcome('2030-01-07', '10:00', '11:00') = 'accepted', 'a future slot is still accepted');
  -- Regression: the new time of a customer change was never compared with the current time.
  PERFORM pg_temp.assert_slot(pg_temp.change_outcome((pg_temp.jst_now() - interval '1 day')::date, '10:00', '11:00', true) = 'BOOKING_SLOT_PASSED',
    'a customer cannot move a reservation to a time that has passed');
  PERFORM pg_temp.assert_slot((SELECT booking_date = '2030-01-07' AND start_time = '14:30' FROM public.bookings
    WHERE id = 'bc140000-0000-4000-8000-000000000001'), 'the refused change leaves the reservation as it was');
  PERFORM pg_temp.assert_slot(pg_temp.change_outcome('2030-01-07', '15:00', '16:00', true) = 'accepted', 'a change to a future time is still accepted');
END $$;

-- 3. Privileges: availability stays server-only; the creators stay as they were.
DO $$ DECLARE role_name text; signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.get_available_slots(uuid,uuid,date,integer)',
    'public.get_available_slots(uuid,uuid,date,integer,uuid)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.assert_slot(NOT has_function_privilege(role_name, signature, 'EXECUTE'), role_name || ' cannot call ' || signature);
    END LOOP;
    PERFORM pg_temp.assert_slot(has_function_privilege('service_role', signature, 'EXECUTE'), 'the API (service role) calls ' || signature);
  END LOOP;
  PERFORM pg_temp.assert_slot(NOT has_function_privilege('service_role',
    'public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])', 'EXECUTE'),
    'the unkeyed public creator stays closed to the service role');
  PERFORM pg_temp.assert_slot(NOT has_function_privilege('authenticated', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE'),
    'the change RPC keeps its grants');
END $$;
ROLLBACK;
