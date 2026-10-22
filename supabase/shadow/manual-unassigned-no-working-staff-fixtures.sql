-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023130100_manual_unassigned_booking_no_working_staff.sql: since 20261023080100
-- a new staff member has no shift until the shop saves one. A 「指名なし」 phone booking
-- on the board (create_manual_booking_atomic -> create_booking_for_menus_atomic with
-- p_enforce_schedule=false) at a time no active staff member works used to be refused
-- as BOOKING_CONFLICT 「この時間帯は既に予約が入っています」 on an empty board.
--   * it is now refused as BOOKING_NO_WORKING_STAFF and nothing is stored (the board can
--     let the shop edit and resubmit: the operation reads as absent);
--   * a named phone booking at the same time is still accepted (shifts are not checked);
--   * inactive staff, a holiday override and a shift that does not cover the slot do not
--     count as working;
--   * when someone works the slot the assignment is unchanged, and a busy working staff
--     member is still BOOKING_CONFLICT;
--   * online bookings (p_enforce_schedule=true) keep BOOKING_CONFLICT.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fe300000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_unassigned(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'manual unassigned booking fixture failed: %', label; END IF; END $$;

SELECT pg_temp.assert_unassigned(NOT has_function_privilege('anon', 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE'),
  'the booking core stays server-only');
SELECT pg_temp.assert_unassigned((SELECT prosecdef FROM pg_proc WHERE oid = 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])'::regprocedure)
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])'::regprocedure) = ARRAY['search_path=public'],
  'SECURITY DEFINER and search_path are unchanged');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe300000-0000-4000-8000-000000000001', 'unassigned-owner@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('fe310000-0000-4000-8000-000000000001', 'Unassigned clinic', 'unassigned-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('fe300000-0000-4000-8000-000000000001', 'fe310000-0000-4000-8000-000000000001', 'owner');
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('fe320000-0000-4000-8000-000000000001', 'fe310000-0000-4000-8000-000000000001', 'synthetic', 'Open menu', 3000, 60, true);
-- A works Tuesdays only (so the shop accepts online bookings). B was added after
-- 20261023080100 and never saved a shift. C works Mondays but is inactive.
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fe330000-0000-4000-8000-000000000001', 'fe310000-0000-4000-8000-000000000001', 'Staff A', 'unassigned-a', true, 1),
 ('fe330000-0000-4000-8000-000000000002', 'fe310000-0000-4000-8000-000000000001', 'Staff B', 'unassigned-b', true, 2),
 ('fe330000-0000-4000-8000-000000000003', 'fe310000-0000-4000-8000-000000000001', 'Staff C', 'unassigned-c', false, 0);
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('fe330000-0000-4000-8000-000000000001', 2, '09:00', '17:00'),
 ('fe330000-0000-4000-8000-000000000003', 1, '09:00', '17:00');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('fe310000-0000-4000-8000-000000000001', 'https://example.invalid/unassigned.jpg', 'other');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'fe310000-0000-4000-8000-000000000001';

-- The board's phone booking, as POST /api/admin/bookings calls it.
CREATE FUNCTION pg_temp.manual(p_op int, p_staff uuid, p_date text, p_start text, p_end text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  result := public.create_manual_booking_atomic('fe300000-0000-4000-8000-000000000001',
    ('fe340000-0000-4000-8000-' || lpad(p_op::text, 12, '0'))::uuid,
    jsonb_build_object('facility_id', 'fe310000-0000-4000-8000-000000000001', 'staff_id', p_staff,
      'menu_ids', jsonb_build_array('fe320000-0000-4000-8000-000000000001'), 'booking_date', p_date,
      'start_time', p_start, 'end_time', p_end, 'customer_name', 'Synthetic phone', 'email', NULL, 'phone', NULL, 'note', NULL));
  RETURN result->>'booking_id';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
-- The online core (schedule gate on), as the receipt gateway calls it.
CREATE FUNCTION pg_temp.online(p_staff uuid, p_date date, p_start time, p_end time) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_booking_for_menus_atomic('fe310000-0000-4000-8000-000000000001', p_staff, NULL,
    'fe320000-0000-4000-8000-000000000001', NULL, p_date, p_start, p_end, 'Synthetic online', 'unassigned@example.invalid',
    NULL, NULL, 3000, 0, 'pending', true, ARRAY['fe320000-0000-4000-8000-000000000001'::uuid]);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.booking(p_id text) RETURNS public.bookings LANGUAGE sql AS $$
  SELECT * FROM public.bookings WHERE id = p_id::uuid;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE outcome text; named text; assigned text;
BEGIN
  PERFORM pg_temp.assert_unassigned(public.facility_booking_ready('fe310000-0000-4000-8000-000000000001'),
    'the synthetic shop accepts online bookings (A works Tuesdays)');

  -- 1. Monday 2030-01-07: no active staff member works. 指名なし is refused with the
  --    accurate code (before the fix: BOOKING_CONFLICT on an empty board).
  outcome := pg_temp.manual(1, NULL, '2030-01-07', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_NO_WORKING_STAFF', '指名なし without working staff (got ' || outcome || ')');
  PERFORM pg_temp.assert_unassigned(NOT EXISTS (SELECT 1 FROM public.bookings WHERE facility_id = 'fe310000-0000-4000-8000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM public.manual_booking_operations WHERE operation_id = 'fe340000-0000-4000-8000-000000000001'),
    'the refused booking and its operation are not stored');
  PERFORM pg_temp.assert_unassigned(public.get_manual_booking_operation('fe300000-0000-4000-8000-000000000001',
    'fe340000-0000-4000-8000-000000000001', 'fe310000-0000-4000-8000-000000000001')->>'state' = 'absent',
    'the board can let the shop edit and resubmit');

  -- 2. The advice works: choosing a staff member is accepted (named phone bookings ignore shifts).
  named := pg_temp.manual(2, 'fe330000-0000-4000-8000-000000000002', '2030-01-07', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned((pg_temp.booking(named)).staff_id = 'fe330000-0000-4000-8000-000000000002'
    AND NOT (pg_temp.booking(named)).staff_auto_assigned, 'named B is accepted at the same time');

  -- 3. Online bookings keep requiring working staff and keep the code they had.
  outcome := pg_temp.online(NULL, '2030-01-07', '12:00', '13:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_CONFLICT', 'online おまかせ without working staff is unchanged (got ' || outcome || ')');
  outcome := pg_temp.online('fe330000-0000-4000-8000-000000000002', '2030-01-07', '12:00', '13:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'STAFF_NOT_WORKING', 'online named B without a shift is unchanged (got ' || outcome || ')');

  -- 4. Tuesday 2030-01-08: A works. The assignment is unchanged; a busy A is still a conflict.
  assigned := pg_temp.manual(3, NULL, '2030-01-08', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned((pg_temp.booking(assigned)).staff_id = 'fe330000-0000-4000-8000-000000000001'
    AND (pg_temp.booking(assigned)).staff_auto_assigned, '指名なし goes to the working A');
  outcome := pg_temp.manual(4, NULL, '2030-01-08', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_CONFLICT', 'working staff all busy is still BOOKING_CONFLICT (got ' || outcome || ')');
  -- A shift that does not cover the whole slot is not working it.
  outcome := pg_temp.manual(5, NULL, '2030-01-08', '16:30', '17:30');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_NO_WORKING_STAFF', 'a shift ending inside the slot does not count (got ' || outcome || ')');
END $$;
RESET ROLE;

-- 5. B saves a Monday shift; a holiday override still closes that Monday.
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time)
 VALUES ('fe330000-0000-4000-8000-000000000002', 1, '09:00', '17:00');
INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time)
 VALUES ('fe330000-0000-4000-8000-000000000002', '2030-01-14', true, NULL, NULL);
SET LOCAL ROLE service_role;
DO $$
DECLARE outcome text; assigned text;
BEGIN
  assigned := pg_temp.manual(6, NULL, '2030-01-07', '11:00', '12:00');
  PERFORM pg_temp.assert_unassigned((pg_temp.booking(assigned)).staff_id = 'fe330000-0000-4000-8000-000000000002'
    AND (pg_temp.booking(assigned)).staff_auto_assigned, 'after saving the shift, 指名なし goes to B');
  outcome := pg_temp.manual(7, NULL, '2030-01-07', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_CONFLICT', 'B working but booked is a real conflict (got ' || outcome || ')');
  outcome := pg_temp.manual(8, NULL, '2030-01-14', '10:00', '11:00');
  PERFORM pg_temp.assert_unassigned(outcome = 'BOOKING_NO_WORKING_STAFF', 'a holiday override is not working (got ' || outcome || ')');
  -- The legacy single-menu wrapper (p_enforce_schedule defaults to false) behaves like the board.
  BEGIN
    PERFORM public.create_booking_atomic('fe310000-0000-4000-8000-000000000001', NULL, NULL, 'fe320000-0000-4000-8000-000000000001', NULL,
      '2030-01-14', '13:00', '14:00', 'Synthetic legacy', NULL, NULL, NULL, 3000);
    RAISE EXCEPTION 'legacy wrapper accepted a booking nobody works';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BOOKING_NO_WORKING_STAFF%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_unassigned((SELECT count(*) = 3 FROM public.bookings WHERE facility_id = 'fe310000-0000-4000-8000-000000000001')
    AND (SELECT count(*) = 3 FROM public.manual_booking_operations WHERE facility_id = 'fe310000-0000-4000-8000-000000000001'),
    'only the accepted phone bookings are stored');
END $$;
RESET ROLE;

SELECT 'manual 指名なし without working staff: accurate refusal, named and online paths unchanged';
ROLLBACK;
