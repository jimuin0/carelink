-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023000000_user_points_own_read_only.sql / 20261023000100_booking_visit_points_cap.sql:
--   * the CareLink points ledger (user_points) is readable only by the customer;
--     the shop's owner cannot read a customer's ledger even with a booking at the shop;
--   * visit points are capped at the booking-time amount the booking RPC stores
--     (bookings.points_base_price = menus + nomination fee - coupon, before points);
--   * bookings without that amount (legacy rows) keep the completed total;
--   * the shop's own owner / admin booking their own shop earn nothing;
--   * a menu without a price (要相談 / unset) stores 0 as the booking amount and so
--     earns nothing, whatever the checkout total (deliberate: no cap would be uncapped);
--   * a completed -> no_show reversal returns exactly what was awarded;
--   * the completion replay check and the ledger audit agree with the new rule.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fd100000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_cap(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'points cap fixture failed: %', label; END IF; END $$;

-- 0. Catalog: the ledger keeps one own-read policy; the cap is server-only.
SELECT pg_temp.assert_cap((SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_points') = ARRAY['user_points_own_read'],
  'user_points keeps only the own-read policy');
SELECT pg_temp.assert_cap((SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_points'
  AND policyname = 'user_points_own_read') = 'SELECT', 'the remaining policy only reads');
SELECT pg_temp.assert_cap(NOT has_function_privilege('anon', 'public.booking_visit_points_due(uuid,uuid,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.booking_visit_points_due(uuid,uuid,integer,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.booking_visit_points_due(uuid,uuid,integer,integer)', 'EXECUTE'),
  'points helper is server-only');
SELECT pg_temp.assert_cap(NOT has_column_privilege('authenticated', 'public.bookings', 'points_base_price', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.bookings', 'points_base_price', 'INSERT')
  AND NOT has_column_privilege('anon', 'public.bookings', 'points_base_price', 'UPDATE'),
  'browsers cannot write the booking-time amount');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fd100000-0000-4000-8000-000000000001', 'cap-owner@example.invalid', now()),
 ('fd100000-0000-4000-8000-000000000002', 'cap-customer@example.invalid', now()),
 ('fd100000-0000-4000-8000-000000000003', 'cap-admin@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
 ('fd110000-0000-4000-8000-000000000001', 'Points cap clinic', 'points-cap-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
 ('fd100000-0000-4000-8000-000000000001', 'fd110000-0000-4000-8000-000000000001', 'owner'),
 ('fd100000-0000-4000-8000-000000000003', 'fd110000-0000-4000-8000-000000000001', 'admin');
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('fd120000-0000-4000-8000-000000000001', 'fd110000-0000-4000-8000-000000000001', 'synthetic', 'Menu', 5000, 30, true);
INSERT INTO public.facility_menus(id, facility_id, category, name, price, price_ask, duration_minutes, is_published) VALUES
 ('fd120000-0000-4000-8000-000000000002', 'fd110000-0000-4000-8000-000000000001', 'synthetic', 'Price on request', NULL, true, 30, true);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fd130000-0000-4000-8000-000000000001', 'fd110000-0000-4000-8000-000000000001', 'Staff', 'points-cap-staff', true, 1);
INSERT INTO public.user_points(user_id, points, reason) VALUES ('fd100000-0000-4000-8000-000000000002', 3000, 'Synthetic seed');

-- The booking RPC as /api/booking calls it: p_total_price is the amount after
-- points, p_points_used the points spent. Named staff and p_enforce_schedule=false
-- keep the schedule gate out of the way; each booking has its own start time.
CREATE FUNCTION pg_temp.book(p_user uuid, p_start time, p_total int, p_points int) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.create_booking_for_menus_atomic('fd110000-0000-4000-8000-000000000001', 'fd130000-0000-4000-8000-000000000001',
    p_user, 'fd120000-0000-4000-8000-000000000001', NULL, '2030-01-07', p_start, p_start + interval '30 minutes',
    'Synthetic', NULL, NULL, NULL, p_total, p_points, 'confirmed', false, ARRAY['fd120000-0000-4000-8000-000000000001'::uuid]);
$$;
-- The owner checks out and completes in one step, as the 退店レジ会計 screen does.
CREATE FUNCTION pg_temp.checkout(p_booking uuid, p_charges text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.checkout_booking_with_points_atomic('fd100000-0000-4000-8000-000000000001', p_booking, 'confirmed',
    (SELECT b.updated_at FROM public.bookings b WHERE b.id = p_booking), p_charges::jsonb, NULL, true);
END $$;
CREATE FUNCTION pg_temp.award(p_booking uuid) RETURNS int LANGUAGE sql AS $$
  SELECT points FROM public.user_points WHERE booking_id = p_booking AND booking_operation = 'award';
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  owner_id constant uuid := 'fd100000-0000-4000-8000-000000000001';
  customer constant uuid := 'fd100000-0000-4000-8000-000000000002';
  admin_id constant uuid := 'fd100000-0000-4000-8000-000000000003';
  facility constant uuid := 'fd110000-0000-4000-8000-000000000001';
  inflated uuid; reduced uuid; plain uuid; legacy uuid := 'fd140000-0000-4000-8000-000000000001';
  own_booking uuid; admin_booking uuid; guest uuid; unpriced uuid;
  earned int; again boolean;
BEGIN
  -- 1. The booking stores the amount before points (5,000 = 4,000 paid + 1,000 points).
  inflated := pg_temp.book(customer, '09:00', 4000, 1000);
  PERFORM pg_temp.assert_cap((SELECT points_base_price = 5000 AND total_price = 4000 AND points_used = 1000
    FROM public.bookings WHERE id = inflated), 'booking stores the amount before points');

  -- 2. A checkout typed far above the booking (200,000,000) earns 1% of the booking amount only.
  PERFORM pg_temp.checkout(inflated, '[{"type":"menu","name":"Synthetic","amount":100000000},{"type":"menu","name":"Synthetic","amount":100000000}]');
  PERFORM pg_temp.assert_cap((SELECT total_price = 200000000 AND status = 'completed' FROM public.bookings WHERE id = inflated)
    AND pg_temp.award(inflated) = 50, 'inflated checkout earns at most 1% of the booking amount');
  PERFORM pg_temp.assert_cap((SELECT amount = 200000000 FROM public.customer_visits WHERE booking_id = inflated),
    'the visit keeps the checkout total (only points are capped)');

  -- 3. A checkout below the booking amount earns on what was charged.
  reduced := pg_temp.book(customer, '09:30', 5000, 0);
  PERFORM pg_temp.checkout(reduced, '[{"type":"menu","name":"Synthetic","amount":5000},{"type":"discount","name":"Synthetic","amount":-2000}]');
  PERFORM pg_temp.assert_cap(pg_temp.award(reduced) = 30, 'a lower checkout earns on the charged amount');

  -- 4. Completion without checkout: the amount after points (3,000) is below the cap (5,000).
  plain := pg_temp.book(customer, '10:00', 3000, 2000);
  SELECT c.points_earned, c.replayed INTO earned, again FROM public.complete_booking_with_points_atomic(owner_id, plain, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 30 AND again = false AND pg_temp.award(plain) = 30, 'plain completion earns on the paid amount');

  -- 5. Replays of a completed booking agree with the capped award (the old check expected 2,000,000).
  SELECT c.points_earned, c.replayed INTO earned, again FROM public.complete_booking_with_points_atomic(owner_id, inflated, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 50 AND again = true, 'capped checkout replays without a reconciliation error');
  SELECT c.points_earned, c.replayed INTO earned, again FROM public.complete_booking_with_points_atomic(owner_id, plain, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 30 AND again = true, 'plain completion replays');

  -- 6. A booking without the stored amount (written before 20261023000100) keeps the completed total.
  INSERT INTO public.bookings(id, facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used)
    VALUES (legacy, facility, customer, '2030-01-07', '13:00', '13:30', 'Synthetic legacy', NULL, 'confirmed', 700, 0);
  PERFORM pg_temp.assert_cap((SELECT points_base_price IS NULL FROM public.bookings WHERE id = legacy), 'legacy row has no stored amount');
  PERFORM pg_temp.checkout(legacy, '[{"type":"menu","name":"Synthetic","amount":4800}]');
  PERFORM pg_temp.assert_cap(pg_temp.award(legacy) = 48, 'legacy row earns on the completed total, never above it');

  -- 7. The shop's own owner and admin earn nothing at their own shop; the visit is still recorded.
  own_booking := pg_temp.book(owner_id, '11:00', 5000, 0);
  PERFORM pg_temp.checkout(own_booking, '[{"type":"menu","name":"Synthetic","amount":5000}]');
  PERFORM pg_temp.assert_cap((SELECT status = 'completed' FROM public.bookings WHERE id = own_booking)
    AND NOT EXISTS (SELECT 1 FROM public.user_points WHERE booking_id = own_booking)
    AND EXISTS (SELECT 1 FROM public.customer_visits WHERE booking_id = own_booking), 'owner self-booking earns nothing');
  SELECT c.points_earned, c.replayed INTO earned, again FROM public.complete_booking_with_points_atomic(owner_id, own_booking, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 0 AND again = true, 'owner self-booking replays with zero points');
  admin_booking := pg_temp.book(admin_id, '11:30', 5000, 0);
  SELECT c.points_earned INTO earned FROM public.complete_booking_with_points_atomic(owner_id, admin_booking, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 0 AND NOT EXISTS (SELECT 1 FROM public.user_points WHERE booking_id = admin_booking),
    'admin self-booking earns nothing');

  -- 8. Guests cannot earn, so no amount is stored for them.
  guest := pg_temp.book(NULL, '12:00', 5000, 0);
  PERFORM pg_temp.assert_cap((SELECT points_base_price IS NULL FROM public.bookings WHERE id = guest), 'guest booking stores no amount');

  -- 9. A menu without a price: /api/booking sums a NULL price as 0, so the booking amount is 0
  --    and a 10,000 checkout earns nothing (the cap is the booking amount, not "no cap").
  unpriced := public.create_booking_for_menus_atomic(facility, 'fd130000-0000-4000-8000-000000000001',
    customer, 'fd120000-0000-4000-8000-000000000002', NULL, '2030-01-07', '12:30', '13:00',
    'Synthetic', NULL, NULL, NULL, 0, 0, 'confirmed', false, ARRAY['fd120000-0000-4000-8000-000000000002'::uuid]);
  PERFORM pg_temp.assert_cap((SELECT points_base_price = 0 FROM public.bookings WHERE id = unpriced), 'unpriced menu stores a zero booking amount');
  PERFORM pg_temp.checkout(unpriced, '[{"type":"menu","name":"Synthetic","amount":10000}]');
  PERFORM pg_temp.assert_cap((SELECT total_price = 10000 AND status = 'completed' FROM public.bookings WHERE id = unpriced)
    AND NOT EXISTS (SELECT 1 FROM public.user_points WHERE booking_id = unpriced)
    AND EXISTS (SELECT 1 FROM public.customer_visits WHERE booking_id = unpriced AND amount = 10000),
    'unpriced menu earns no visit points whatever the checkout total');
  SELECT c.points_earned, c.replayed INTO earned, again FROM public.complete_booking_with_points_atomic(owner_id, unpriced, 'confirmed') c;
  PERFORM pg_temp.assert_cap(earned = 0 AND again = true, 'unpriced menu replays with zero points');

  -- 10. The ledger audit agrees with the new rule (no capped, legacy, self-booking or unpriced row is reported).
  PERFORM pg_temp.assert_cap(NOT EXISTS (SELECT 1 FROM public.booking_point_legacy_issues() i
    JOIN public.bookings b ON b.id = i.booking_id WHERE b.facility_id = facility), 'audit reports nothing for the new rule');

  -- 11. completed -> no_show returns exactly what was awarded (-50, not -2,000,000).
  PERFORM public.save_booking_email_event_atomic(owner_id, inflated, 'completed',
    (SELECT updated_at FROM public.bookings WHERE id = inflated), 'no_show', NULL);
  PERFORM pg_temp.assert_cap((SELECT points = -50 FROM public.user_points WHERE booking_id = inflated AND booking_operation = 'reversal'),
    'reversal returns the capped award');
  PERFORM public.save_booking_email_event_atomic(owner_id, own_booking, 'completed',
    (SELECT updated_at FROM public.bookings WHERE id = own_booking), 'no_show', NULL);
  PERFORM pg_temp.assert_cap(NOT EXISTS (SELECT 1 FROM public.user_points WHERE booking_id = own_booking),
    'nothing awarded, nothing reversed');
  PERFORM pg_temp.assert_cap(NOT EXISTS (SELECT 1 FROM public.booking_point_legacy_issues() i
    JOIN public.bookings b ON b.id = i.booking_id WHERE b.facility_id = facility), 'audit stays clean after the reversals');

  -- 3,000 seed - 1,000 - 2,000 spent + 50 + 30 + 30 + 48 earned - 50 reversed.
  PERFORM pg_temp.assert_cap((SELECT sum(points) = 108 FROM public.user_points WHERE user_id = customer), 'exact final balance');
END $$;
RESET ROLE;

-- 12. Ledger privacy under RLS: the owner of the shop the customer booked cannot read the ledger.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
SELECT set_config('request.jwt.claim.sub', 'fd100000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_cap((SELECT count(*) FROM public.bookings WHERE user_id = 'fd100000-0000-4000-8000-000000000002') > 0,
  'the owner still sees the customer''s bookings at the shop (the removed policy''s condition holds)');
SELECT pg_temp.assert_cap((SELECT count(*) FROM public.user_points WHERE user_id = 'fd100000-0000-4000-8000-000000000002') = 0,
  'the shop owner cannot read the customer''s ledger');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'fd100000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_cap((SELECT sum(points) = 108 FROM public.user_points), 'the customer reads exactly their own ledger');
RESET ROLE;
SELECT 'points ledger privacy, visit points cap, legacy, self-booking, unpriced menu, reversal and audit checks passed';
ROLLBACK;
