-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- おまかせ staff assignment, legacy unassigned capacity, and the named/change paths
-- that previously double-booked (20261022100000 / 20261022100100), the
-- おまかせ/nominated distinction (staff_auto_assigned) and its change path,
-- assigned reservations whose member was later given time off, and the LINE
-- WORKS notice to the assigned member.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_assign(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'staff assignment fixture failed: %', label; END IF; END $$;

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('ba500000-0000-4000-8000-000000000001', 'assignment-customer@example.invalid', now()),
 ('ba500000-0000-4000-8000-000000000002', 'assignment-owner@example.invalid', now());
UPDATE public.profiles SET email = NULL WHERE id = 'ba500000-0000-4000-8000-000000000002';
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('ba510000-0000-4000-8000-000000000001', 'Assignment clinic', 'assignment-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('ba500000-0000-4000-8000-000000000002', 'ba510000-0000-4000-8000-000000000001', 'owner');
INSERT INTO public.facility_notification_settings(facility_id, push_on_new_booking)
 VALUES ('ba510000-0000-4000-8000-000000000001', false);
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('ba520000-0000-4000-8000-000000000001', 'ba510000-0000-4000-8000-000000000001', 'synthetic', 'Open menu', 500, 60, true),
 ('ba520000-0000-4000-8000-000000000002', 'ba510000-0000-4000-8000-000000000001', 'synthetic', 'B only menu', 500, 60, true);
-- C (inactive) and D (off on Mondays) sort before A and B but must never be assigned.
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('ba530000-0000-4000-8000-000000000001', 'ba510000-0000-4000-8000-000000000001', 'Staff A', 'assignment-a', true, 1),
 ('ba530000-0000-4000-8000-000000000002', 'ba510000-0000-4000-8000-000000000001', 'Staff B', 'assignment-b', true, 2),
 ('ba530000-0000-4000-8000-000000000003', 'ba510000-0000-4000-8000-000000000001', 'Staff C', 'assignment-c', false, 0),
 ('ba530000-0000-4000-8000-000000000004', 'ba510000-0000-4000-8000-000000000001', 'Staff D', 'assignment-d', true, 0);
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('ba530000-0000-4000-8000-000000000001', 1, '09:00', '17:00'),
 ('ba530000-0000-4000-8000-000000000002', 1, '09:00', '17:00'),
 ('ba530000-0000-4000-8000-000000000003', 1, '09:00', '17:00'),
 ('ba530000-0000-4000-8000-000000000004', 2, '09:00', '17:00');
INSERT INTO public.menu_staff(menu_id, staff_id)
 VALUES ('ba520000-0000-4000-8000-000000000002', 'ba530000-0000-4000-8000-000000000002');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('ba510000-0000-4000-8000-000000000001', 'https://example.invalid/assignment.jpg', 'other');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'ba510000-0000-4000-8000-000000000001';

-- Public path (schedule gate on). p_menus[1] is the primary menu.
CREATE FUNCTION pg_temp.book(p_date date, p_staff uuid, p_start time, p_end time,
  p_menus uuid[] DEFAULT ARRAY['ba520000-0000-4000-8000-000000000001'::uuid]) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.create_booking_for_menus_atomic('ba510000-0000-4000-8000-000000000001', p_staff, NULL, p_menus[1], NULL,
    p_date, p_start, p_end, 'Synthetic', 'assignment@example.invalid', NULL, NULL, 0, 0, 'pending', true, p_menus);
$$;
CREATE FUNCTION pg_temp.book_outcome(p_date date, p_staff uuid, p_start time, p_end time,
  p_menus uuid[] DEFAULT ARRAY['ba520000-0000-4000-8000-000000000001'::uuid]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.book(p_date, p_staff, p_start, p_end, p_menus);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.staff_of(p_booking uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT staff_id FROM public.bookings WHERE id = p_booking;
$$;
CREATE FUNCTION pg_temp.has_slot(p_staff uuid, p_date date, p_start time) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.get_available_slots('ba510000-0000-4000-8000-000000000001', p_staff, p_date, 60) s
    WHERE s.slot_start = p_start);
$$;

-- 1. おまかせ is stored with a concrete free staff member (2030-01-07, Monday).
DO $$ DECLARE first_id uuid; second_id uuid; named_id uuid;
BEGIN
  PERFORM pg_temp.assert_assign(public.facility_booking_ready('ba510000-0000-4000-8000-000000000001'), 'synthetic facility accepts online bookings');
  first_id := pg_temp.book('2030-01-07', NULL, '10:00', '11:00');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(first_id) = 'ba530000-0000-4000-8000-000000000001',
    'first おまかせ goes to the first active staff working the slot by sort order (not inactive C, not off-duty D)');
  second_id := pg_temp.book('2030-01-07', NULL, '10:00', '11:00');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(second_id) = 'ba530000-0000-4000-8000-000000000002', 'second おまかせ takes the next free staff');
  PERFORM pg_temp.assert_assign((SELECT bool_and(staff_auto_assigned) FROM public.bookings WHERE id IN (first_id, second_id)),
    'an assigned おまかせ reservation is recorded as not nominated');
  named_id := pg_temp.book('2030-01-07', 'ba530000-0000-4000-8000-000000000001', '15:00', '16:00');
  PERFORM pg_temp.assert_assign((SELECT staff_id = 'ba530000-0000-4000-8000-000000000001' AND NOT staff_auto_assigned
    FROM public.bookings WHERE id = named_id), 'a nominated reservation is not marked as assigned');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-07', NULL, '10:30', '11:30') = 'BOOKING_CONFLICT', 'no free staff refuses おまかせ');
  -- Regression: named staff A used to be accepted on top of an おまかせ reservation.
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-07', 'ba530000-0000-4000-8000-000000000001', '10:30', '11:30') = 'BOOKING_CONFLICT',
    'named staff sees the おまかせ reservation assigned to them');
  PERFORM pg_temp.assert_assign(NOT pg_temp.has_slot('ba530000-0000-4000-8000-000000000001', '2030-01-07', '10:00'),
    'availability no longer offers the slot taken by an おまかせ reservation');
  PERFORM pg_temp.assert_assign(NOT EXISTS (SELECT 1 FROM public.bookings WHERE facility_id = 'ba510000-0000-4000-8000-000000000001' AND staff_id IS NULL),
    'no new reservation is stored without a staff member');
END $$;

-- 2. menu_staff is respected for every booked menu.
DO $$ DECLARE new_id uuid;
BEGIN
  new_id := pg_temp.book('2030-01-07', NULL, '12:00', '13:00', ARRAY['ba520000-0000-4000-8000-000000000002'::uuid]);
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_id) = 'ba530000-0000-4000-8000-000000000002', 'a B-only menu skips A even though A sorts first');
  new_id := pg_temp.book('2030-01-07', NULL, '14:00', '15:00',
    ARRAY['ba520000-0000-4000-8000-000000000001'::uuid, 'ba520000-0000-4000-8000-000000000002'::uuid]);
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_id) = 'ba530000-0000-4000-8000-000000000002', 'a secondary B-only menu also restricts the assignment');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-07', NULL, '14:00', '15:00',
    ARRAY['ba520000-0000-4000-8000-000000000001'::uuid, 'ba520000-0000-4000-8000-000000000002'::uuid]) = 'BOOKING_CONFLICT',
    'the free staff A cannot take a reservation with a menu A does not handle');
  new_id := pg_temp.book('2030-01-07', NULL, '14:00', '15:00');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_id) = 'ba530000-0000-4000-8000-000000000001', 'an open menu still goes to the free staff A');
END $$;

-- 3. Date overrides and the facility buffer (2030-01-21, Monday).
INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time) VALUES
 ('ba530000-0000-4000-8000-000000000001', '2030-01-21', true, NULL, NULL),
 ('ba530000-0000-4000-8000-000000000002', '2030-01-21', false, '13:00', '17:00');
UPDATE public.facility_profiles SET booking_buffer_minutes = 15 WHERE id = 'ba510000-0000-4000-8000-000000000001';
DO $$ DECLARE new_id uuid;
BEGIN
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-21', NULL, '10:00', '11:00') = 'BOOKING_CONFLICT',
    'A on holiday and B starting at 13:00 leave nobody for 10:00');
  new_id := pg_temp.book('2030-01-21', NULL, '13:00', '14:00');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_id) = 'ba530000-0000-4000-8000-000000000002', 'override hours are used for the assignment');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-21', NULL, '14:05', '15:05') = 'BOOKING_CONFLICT',
    'the facility buffer after a reservation also blocks the assignment');
  new_id := pg_temp.book('2030-01-21', NULL, '14:15', '15:15');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_id) = 'ba530000-0000-4000-8000-000000000002', 'after the buffer the staff is free again');
END $$;
UPDATE public.facility_profiles SET booking_buffer_minutes = 0 WHERE id = 'ba510000-0000-4000-8000-000000000001';

-- 4. Legacy reservations stored without a staff member still occupy capacity (2030-01-14, Monday).
INSERT INTO public.bookings(id, facility_id, staff_id, menu_id, booking_date, start_time, end_time, customer_name, email, status)
 VALUES ('ba540000-0000-4000-8000-000000000001', 'ba510000-0000-4000-8000-000000000001', NULL, 'ba520000-0000-4000-8000-000000000001',
  '2030-01-14', '16:00', '17:00', 'Legacy', 'legacy@example.invalid', 'confirmed');
DO $$ BEGIN
  PERFORM pg_temp.assert_assign(pg_temp.has_slot('ba530000-0000-4000-8000-000000000002', '2030-01-14', '16:00'),
    'one legacy reservation leaves one of the two working staff');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-14', 'ba530000-0000-4000-8000-000000000001', '16:00', '17:00') = 'accepted',
    'named A fits next to one legacy reservation');
  -- Regression: B's slot was still offered and a named B reservation accepted (3 reservations, 2 staff).
  PERFORM pg_temp.assert_assign(NOT pg_temp.has_slot('ba530000-0000-4000-8000-000000000002', '2030-01-14', '16:00'),
    'legacy plus named reservations fill the working staff in availability');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-14', 'ba530000-0000-4000-8000-000000000002', '16:00', '17:00') = 'BOOKING_CONFLICT',
    'named B is refused while a legacy reservation needs the remaining staff');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-14', NULL, '16:00', '17:00') = 'BOOKING_CONFLICT',
    'おまかせ is refused when legacy reservations fill the working staff');
  PERFORM pg_temp.assert_assign(pg_temp.has_slot('ba530000-0000-4000-8000-000000000002', '2030-01-14', '10:00'),
    'other times of the same day are unaffected');
  UPDATE public.bookings SET status = 'cancelled' WHERE id = 'ba540000-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_assign(pg_temp.has_slot('ba530000-0000-4000-8000-000000000002', '2030-01-14', '16:00'),
    'a cancelled legacy reservation releases its capacity');
END $$;

-- 5. Customer change of a named reservation (2030-01-28, Monday).
INSERT INTO public.bookings(id, facility_id, staff_id, user_id, menu_id, booking_date, start_time, end_time, customer_name, email, status) VALUES
 ('ba540000-0000-4000-8000-000000000002', 'ba510000-0000-4000-8000-000000000001', 'ba530000-0000-4000-8000-000000000001',
  'ba500000-0000-4000-8000-000000000001', 'ba520000-0000-4000-8000-000000000001', '2030-01-28', '10:00', '11:00', 'Customer',
  'assignment-customer@example.invalid', 'confirmed'),
 ('ba540000-0000-4000-8000-000000000003', 'ba510000-0000-4000-8000-000000000001', NULL, NULL,
  'ba520000-0000-4000-8000-000000000001', '2030-01-28', '12:00', '13:00', 'Legacy', 'legacy@example.invalid', 'confirmed'),
 ('ba540000-0000-4000-8000-000000000004', 'ba510000-0000-4000-8000-000000000001', NULL, NULL,
  'ba520000-0000-4000-8000-000000000001', '2030-01-28', '14:00', '15:00', 'Legacy', 'legacy@example.invalid', 'confirmed'),
 ('ba540000-0000-4000-8000-000000000005', 'ba510000-0000-4000-8000-000000000001', 'ba530000-0000-4000-8000-000000000001',
  'ba500000-0000-4000-8000-000000000001', 'ba520000-0000-4000-8000-000000000001', '2020-01-06', '10:00', '11:00', 'Customer',
  'assignment-customer@example.invalid', 'confirmed');
DO $$ BEGIN
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-01-28', 'ba530000-0000-4000-8000-000000000002', '12:00', '13:00') = 'accepted',
    'named B fits next to the legacy reservation at 12:00');
  -- Regression: A was free at 12:00, so the change was accepted with 3 reservations for 2 staff.
  BEGIN
    PERFORM public.change_booking_atomic('ba540000-0000-4000-8000-000000000002', 'ba500000-0000-4000-8000-000000000001', '2030-01-28', '12:00', '13:00', true);
    RAISE EXCEPTION 'legacy capacity ignored by change';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_CONFLICT%' THEN RAISE; END IF; END;
  PERFORM public.change_booking_atomic('ba540000-0000-4000-8000-000000000002', 'ba500000-0000-4000-8000-000000000001', '2030-01-28', '14:00', '15:00', true);
  PERFORM public.change_booking_atomic('ba540000-0000-4000-8000-000000000002', 'ba500000-0000-4000-8000-000000000001', '2030-01-28', '14:30', '15:30', true);
  PERFORM pg_temp.assert_assign((SELECT start_time = '14:30' AND staff_id = 'ba530000-0000-4000-8000-000000000001'
    FROM public.bookings WHERE id = 'ba540000-0000-4000-8000-000000000002'), 'the moved reservation does not count against itself');
  -- A customer cannot move a reservation whose start time has passed (JST).
  BEGIN
    PERFORM public.change_booking_atomic('ba540000-0000-4000-8000-000000000005', 'ba500000-0000-4000-8000-000000000001', '2030-01-28', '16:00', '17:00', true);
    RAISE EXCEPTION 'started reservation moved';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'BOOKING_ALREADY_STARTED' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_assign((SELECT booking_date = '2020-01-06' FROM public.bookings WHERE id = 'ba540000-0000-4000-8000-000000000005'),
    'the started reservation keeps its date');
END $$;

-- 6. Receipt gateway: an assigned おまかせ keeps the customer's snapshot (no staff name) and
--    its notification is not superseded by the assignment (2030-02-04, Monday).
SET LOCAL ROLE service_role;
SELECT * FROM public.prepare_booking_create_operation('ba550000-0000-4000-8000-000000000001', 'ba500000-0000-4000-8000-000000000001', NULL,
  'ba510000-0000-4000-8000-000000000001', repeat('a', 64));
DO $$ DECLARE snap jsonb; plan jsonb; response jsonb; new_booking uuid; qid uuid; outcome text;
BEGIN
  snap := jsonb_build_object('customer_name', 'Synthetic', 'email', 'proxy@example.invalid', 'facility_name', 'Assignment clinic',
    'menu_name', 'Open menu', 'staff_name', NULL::text, 'booking_date', '2030-02-04', 'start_time', '10:00', 'end_time', '10:30',
    'total_price', 400, 'status', 'confirmed');
  plan := jsonb_build_array(
    jsonb_build_object('kind', 'email', 'role', 'customer', 'target', 'proxy@example.invalid',
      'envelope', jsonb_build_object('from', 'test@example.invalid', 'to', 'proxy@example.invalid', 'subject', 'Synthetic receipt', 'html', '<p>Synthetic</p>'),
      'snapshot', snap,
      'context', jsonb_build_object('owner_ids', jsonb_build_array('ba500000-0000-4000-8000-000000000002'), 'owner_push', false,
        'works_enabled', false, 'line_enabled', false)),
    jsonb_build_object('kind', 'push', 'role', 'customer', 'target', 'ba500000-0000-4000-8000-000000000001',
      'payload', jsonb_build_object('title', 'Synthetic', 'body', 'Synthetic'), 'snapshot', snap));
  SELECT r.response_payload INTO response FROM public.create_booking_with_receipt_atomic('ba550000-0000-4000-8000-000000000001',
    'ba500000-0000-4000-8000-000000000001', NULL, repeat('a', 64), 'ba510000-0000-4000-8000-000000000001', NULL,
    'ba520000-0000-4000-8000-000000000001', NULL, '2030-02-04', '10:00', '10:30', 'Synthetic', 'proxy@example.invalid', NULL, NULL,
    400, 0, 'confirmed', ARRAY['ba520000-0000-4000-8000-000000000001'::uuid], plan) r;
  PERFORM pg_temp.assert_assign(response->>'state' = 'accepted', 'おまかせ through the receipt gateway is accepted');
  new_booking := (response->>'bookingId')::uuid;
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(new_booking) = 'ba530000-0000-4000-8000-000000000001', 'the receipt gateway stores the assigned staff');
  SELECT q.id INTO qid FROM public.webhook_retry_queue q
    WHERE q.payload->>'booking_create_operation' = 'ba550000-0000-4000-8000-000000000001' AND q.webhook_type = 'email';
  PERFORM pg_temp.assert_assign((SELECT q.payload->'booking_snapshot'->'staff_name' = 'null'::jsonb FROM public.webhook_retry_queue q WHERE q.id = qid),
    'the customer email keeps the おまかせ snapshot');
  PERFORM * FROM public.claim_webhook_retry_queue_v2(ARRAY[qid], '2030-01-01T00:00Z');
  SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid, '2030-01-01T00:00Z') x;
  PERFORM pg_temp.assert_assign(outcome = 'ready', 'the assignment does not supersede the customer email');
END $$;
RESET ROLE;

-- 7. A reservation without a nomination is assigned again when the customer changes it;
--    a nominated one keeps its member (Mondays 2030-02-11 .. 2030-03-04).
DO $$ DECLARE auto_id uuid; b_menu_id uuid; named_id uuid;
  customer constant uuid := 'ba500000-0000-4000-8000-000000000001';
  legacy_id constant uuid := 'ba540000-0000-4000-8000-000000000006';
BEGIN
  auto_id := public.create_booking_for_menus_atomic('ba510000-0000-4000-8000-000000000001', NULL, customer,
    'ba520000-0000-4000-8000-000000000001', NULL, '2030-02-11', '10:00', '11:00', 'Customer', 'assignment-customer@example.invalid',
    NULL, NULL, 0, 0, 'confirmed', true, ARRAY['ba520000-0000-4000-8000-000000000001'::uuid]);
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(auto_id) = 'ba530000-0000-4000-8000-000000000001'::uuid, 'the customer おまかせ starts with A');
  PERFORM pg_temp.book('2030-02-11', 'ba530000-0000-4000-8000-000000000001'::uuid, '13:00', '14:00');
  -- Regression: the assigned member was treated as nominated, so moving to a time when only A
  -- was busy failed with BOOKING_CONFLICT although B was free.
  PERFORM public.change_booking_atomic(auto_id, customer, '2030-02-11', '13:00', '14:00', true);
  PERFORM pg_temp.assert_assign((SELECT staff_id = 'ba530000-0000-4000-8000-000000000002'::uuid AND staff_auto_assigned AND start_time = '13:00'
    FROM public.bookings WHERE id = auto_id), 'a change to a time when only another member is free moves the おまかせ to that member');
  PERFORM public.change_booking_atomic(auto_id, customer, '2030-02-11', '15:00', '16:00', true);
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(auto_id) = 'ba530000-0000-4000-8000-000000000002'::uuid,
    'while the current member is free the change keeps them instead of moving back by sort order');
  -- Regression: after the current member got a day off the change failed with STAFF_NOT_WORKING.
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time) VALUES ('ba530000-0000-4000-8000-000000000002'::uuid, '2030-02-18', true, NULL, NULL);
  PERFORM public.change_booking_atomic(auto_id, customer, '2030-02-18', '10:00', '11:00', true);
  PERFORM pg_temp.assert_assign((SELECT staff_id = 'ba530000-0000-4000-8000-000000000001'::uuid AND staff_auto_assigned AND booking_date = '2030-02-18'
    FROM public.bookings WHERE id = auto_id), 'a change to a day the current member is off goes to a working member');
  PERFORM pg_temp.book('2030-02-18', 'ba530000-0000-4000-8000-000000000001'::uuid, '12:00', '13:00');
  BEGIN
    PERFORM public.change_booking_atomic(auto_id, customer, '2030-02-18', '12:00', '13:00', true);
    RAISE EXCEPTION 'change accepted without a free member';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_CONFLICT%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_assign((SELECT start_time = '10:00' AND staff_id = 'ba530000-0000-4000-8000-000000000001'::uuid FROM public.bookings WHERE id = auto_id),
    'a refused change leaves the reservation and its member');

  -- menu_staff is respected on a change: A cannot take the B-only menu even when free.
  b_menu_id := public.create_booking_for_menus_atomic('ba510000-0000-4000-8000-000000000001', NULL, customer,
    'ba520000-0000-4000-8000-000000000002', NULL, '2030-02-25', '10:00', '11:00', 'Customer', 'assignment-customer@example.invalid',
    NULL, NULL, 0, 0, 'confirmed', true, ARRAY['ba520000-0000-4000-8000-000000000002'::uuid]);
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(b_menu_id) = 'ba530000-0000-4000-8000-000000000002'::uuid, 'the B-only menu is assigned to B');
  PERFORM pg_temp.book('2030-02-25', 'ba530000-0000-4000-8000-000000000002'::uuid, '13:00', '14:00');
  BEGIN
    PERFORM public.change_booking_atomic(b_menu_id, customer, '2030-02-25', '13:00', '14:00', true);
    RAISE EXCEPTION 'change assigned a member who does not handle the menu';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_CONFLICT%' THEN RAISE; END IF; END;

  -- A nominated reservation keeps its member: no silent move to another member.
  named_id := public.create_booking_for_menus_atomic('ba510000-0000-4000-8000-000000000001', 'ba530000-0000-4000-8000-000000000001'::uuid, customer,
    'ba520000-0000-4000-8000-000000000001', NULL, '2030-02-25', '15:00', '16:00', 'Customer', 'assignment-customer@example.invalid',
    NULL, NULL, 0, 0, 'confirmed', true, ARRAY['ba520000-0000-4000-8000-000000000001'::uuid]);
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time) VALUES ('ba530000-0000-4000-8000-000000000001'::uuid, '2030-03-04', true, NULL, NULL);
  BEGIN
    PERFORM public.change_booking_atomic(named_id, customer, '2030-03-04', '15:00', '16:00', true);
    RAISE EXCEPTION 'nominated member replaced';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'STAFF_NOT_WORKING%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_assign((SELECT staff_id = 'ba530000-0000-4000-8000-000000000001'::uuid AND NOT staff_auto_assigned AND booking_date = '2030-02-25'
    FROM public.bookings WHERE id = named_id), 'the nominated reservation keeps its member and date');

  -- A legacy reservation without staff is assigned when it is changed.
  INSERT INTO public.bookings(id, facility_id, staff_id, user_id, menu_id, booking_date, start_time, end_time, customer_name, email, status)
   VALUES (legacy_id, 'ba510000-0000-4000-8000-000000000001', NULL, customer, 'ba520000-0000-4000-8000-000000000001',
    '2030-02-25', '16:00', '17:00', 'Customer', 'assignment-customer@example.invalid', 'confirmed');
  PERFORM public.change_booking_atomic(legacy_id, customer, '2030-02-25', '11:00', '12:00', true);
  PERFORM pg_temp.assert_assign((SELECT staff_id = 'ba530000-0000-4000-8000-000000000001'::uuid AND staff_auto_assigned FROM public.bookings WHERE id = legacy_id),
    'a changed legacy reservation gets a member and stays not nominated');
END $$;

-- 8. An assigned reservation whose member is later given the day off still needs one of the
--    members who work (2030-03-11, Monday). The staff schedule save can be forced over reservations.
DO $$ DECLARE orphan_id uuid;
BEGIN
  orphan_id := pg_temp.book('2030-03-11', NULL, '10:00', '11:00');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(orphan_id) = 'ba530000-0000-4000-8000-000000000001'::uuid, 'the おまかせ is assigned to A');
  PERFORM pg_temp.assert_assign(pg_temp.has_slot('ba530000-0000-4000-8000-000000000002'::uuid, '2030-03-11', '10:00'), 'B is free next to A''s reservation');
  INSERT INTO public.schedule_overrides(staff_id, date, is_holiday, start_time, end_time) VALUES ('ba530000-0000-4000-8000-000000000001'::uuid, '2030-03-11', true, NULL, NULL);
  -- Regression: the reservation stayed on the absent A, so B's 10:00 looked free and a second
  -- reservation was accepted with one member working.
  PERFORM pg_temp.assert_assign(NOT pg_temp.has_slot('ba530000-0000-4000-8000-000000000002'::uuid, '2030-03-11', '10:00'),
    'availability counts the reservation of the absent member against the working member');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-03-11', 'ba530000-0000-4000-8000-000000000002'::uuid, '10:00', '11:00') = 'BOOKING_CONFLICT',
    'named B is refused while the reservation of the absent member needs B');
  PERFORM pg_temp.assert_assign(pg_temp.book_outcome('2030-03-11', NULL, '10:00', '11:00') = 'BOOKING_CONFLICT',
    'おまかせ is refused for the same reason');
  PERFORM pg_temp.assert_assign(pg_temp.has_slot('ba530000-0000-4000-8000-000000000002'::uuid, '2030-03-11', '12:00'), 'other times of the day are unaffected');
END $$;

-- 9. The assigned member's own LINE WORKS channel is told about an おまかせ reservation
--    unless a notify_all channel already covers it (2030-03-18, Monday).
UPDATE public.staff_profiles SET line_works_channel_id = 'assignment-a-works' WHERE id = 'ba530000-0000-4000-8000-000000000001'::uuid;
UPDATE public.staff_profiles SET line_works_channel_id = 'assignment-shared', line_works_notify_all = true WHERE id = 'ba530000-0000-4000-8000-000000000002'::uuid;
CREATE FUNCTION pg_temp.receipt_omakase(p_operation uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE snap jsonb; plan jsonb; response jsonb;
BEGIN
  PERFORM public.prepare_booking_create_operation(p_operation, 'ba500000-0000-4000-8000-000000000001', NULL,
    'ba510000-0000-4000-8000-000000000001', repeat('c', 64));
  snap := jsonb_build_object('customer_name', 'Synthetic', 'email', 'proxy@example.invalid', 'facility_name', 'Assignment clinic',
    'menu_name', 'Open menu', 'staff_name', NULL::text, 'booking_date', '2030-03-18', 'start_time', '10:00', 'end_time', '10:30',
    'total_price', 400, 'status', 'confirmed');
  plan := jsonb_build_array(
    jsonb_build_object('kind', 'email', 'role', 'customer', 'target', 'proxy@example.invalid',
      'envelope', jsonb_build_object('from', 'test@example.invalid', 'to', 'proxy@example.invalid', 'subject', 'Synthetic receipt', 'html', '<p>Synthetic</p>'),
      'snapshot', snap,
      'context', jsonb_build_object('owner_ids', jsonb_build_array('ba500000-0000-4000-8000-000000000002'), 'owner_push', false,
        'works_enabled', true, 'line_enabled', false)),
    jsonb_build_object('kind', 'push', 'role', 'customer', 'target', 'ba500000-0000-4000-8000-000000000001',
      'payload', jsonb_build_object('title', 'Synthetic', 'body', 'Synthetic'), 'snapshot', snap),
    jsonb_build_object('kind', 'line_works', 'role', 'staff', 'target', 'assignment-shared',
      'payload', jsonb_build_object('customerName', 'Synthetic', 'menuName', 'Open menu', 'bookingDate', '2030-03-18', 'startTime', '10:00'),
      'snapshot', snap));
  SELECT r.response_payload INTO response FROM public.create_booking_with_receipt_atomic(p_operation,
    'ba500000-0000-4000-8000-000000000001', NULL, repeat('c', 64), 'ba510000-0000-4000-8000-000000000001', NULL,
    'ba520000-0000-4000-8000-000000000001', NULL, '2030-03-18', '10:00', '10:30', 'Synthetic', 'proxy@example.invalid', NULL, NULL,
    400, 0, 'confirmed', ARRAY['ba520000-0000-4000-8000-000000000001'::uuid], plan) r;
  RETURN (response->>'bookingId')::uuid;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE first_booking uuid; second_booking uuid; qid uuid; outcome text;
BEGIN
  first_booking := pg_temp.receipt_omakase('ba550000-0000-4000-8000-000000000002');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(first_booking) = 'ba530000-0000-4000-8000-000000000001'::uuid, 'the first おまかせ is assigned to A');
  -- Regression: only the client plan's channels (the nominated member and notify_all) were queued,
  -- so the member who now has the reservation was never told.
  SELECT q.id INTO qid FROM public.webhook_retry_queue q
    WHERE q.payload->>'booking_create_operation' = 'ba550000-0000-4000-8000-000000000002'
      AND q.webhook_type = 'booking_creation_lineworks' AND q.target_id = 'assignment-a-works'
      AND q.payload->>'booking_role' = 'staff' AND q.payload->>'staffName' = 'Staff A'
      AND q.payload->>'customerName' = 'Synthetic' AND q.payload->>'menuName' = 'Open menu'
      AND q.payload->>'bookingDate' = '2030-03-18' AND q.payload->>'startTime' = '10:00'
      AND q.payload->'booking_snapshot'->'staff_name' = 'null'::jsonb;
  PERFORM pg_temp.assert_assign(qid IS NOT NULL, 'the assigned member''s own channel is queued with the reservation');
  PERFORM pg_temp.assert_assign((SELECT count(*) = 2 FROM public.webhook_retry_queue q
    WHERE q.payload->>'booking_create_operation' = 'ba550000-0000-4000-8000-000000000002' AND q.webhook_type = 'booking_creation_lineworks'),
    'the notify_all channel from the plan plus the assigned member''s channel');
  PERFORM * FROM public.claim_webhook_retry_queue_v2(ARRAY[qid], '2030-01-01T00:00Z');
  SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid, '2030-01-01T00:00Z') x;
  PERFORM pg_temp.assert_assign(outcome = 'ready', 'the assigned member''s notice is current at send time');

  second_booking := pg_temp.receipt_omakase('ba550000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_assign(pg_temp.staff_of(second_booking) = 'ba530000-0000-4000-8000-000000000002'::uuid, 'the second おまかせ is assigned to B');
  PERFORM pg_temp.assert_assign((SELECT count(*) = 1 FROM public.webhook_retry_queue q
    WHERE q.payload->>'booking_create_operation' = 'ba550000-0000-4000-8000-000000000003' AND q.webhook_type = 'booking_creation_lineworks'),
    'a member whose channel is already a notify_all channel is not notified twice');
END $$;
RESET ROLE;

DO $$ DECLARE role_name text; signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])',
    'public.booking_staff_works_slot(uuid,date,time,time)',
    'public.booking_unassigned_capacity_full(uuid,date,time,time,integer,uuid)',
    'public.booking_needs_any_staff(uuid,boolean,uuid,date,time,time)',
    'public.booking_pick_free_staff(uuid,date,time,time,integer,uuid[],uuid,uuid)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      PERFORM pg_temp.assert_assign(NOT has_function_privilege(role_name, signature, 'EXECUTE'), 'public roles cannot call ' || signature);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.assert_assign(has_function_privilege('service_role',
    'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE'),
    'manual bookings (service role) can reach the assignment');
  PERFORM pg_temp.assert_assign(NOT has_function_privilege('service_role',
    'public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])', 'EXECUTE'),
    'the unkeyed public creator stays closed to the service role');
END $$;
ROLLBACK;
