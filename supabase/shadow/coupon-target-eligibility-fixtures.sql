-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- Coupon target 新規 (new_customer) / リピーター (repeat) enforced by
-- create_booking_for_menus_atomic (20261022160000_coupon_target_eligibility.sql):
-- history = a non-cancelled booking at the same facility, matched by user or by
-- the canonical e-mail; a rejection leaves no booking and no redemption.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'cb100000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_target(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon target fixture failed: %', label; END IF; END $$;

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('cb100000-0000-4000-8000-000000000001', 'target-member@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
 ('cb110000-0000-4000-8000-000000000001', 'Coupon target clinic', 'coupon-target-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft'),
 ('cb110000-0000-4000-8000-000000000002', 'Other clinic', 'coupon-target-other-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('cb120000-0000-4000-8000-000000000001', 'cb110000-0000-4000-8000-000000000001', 'synthetic', 'Menu', 1000, 30, true),
 ('cb120000-0000-4000-8000-000000000002', 'cb110000-0000-4000-8000-000000000002', 'synthetic', 'Menu', 1000, 30, true);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('cb130000-0000-4000-8000-000000000001', 'cb110000-0000-4000-8000-000000000001', 'Staff', 'coupon-target-staff', true, 1),
 ('cb130000-0000-4000-8000-000000000002', 'cb110000-0000-4000-8000-000000000002', 'Staff', 'coupon-target-staff', true, 1);
INSERT INTO public.coupons(id, facility_id, name, coupon_type, discount_type, discount_value) VALUES
 ('cb140000-0000-4000-8000-000000000001', 'cb110000-0000-4000-8000-000000000001', 'First visit', 'new_customer', 'fixed', 500),
 ('cb140000-0000-4000-8000-000000000002', 'cb110000-0000-4000-8000-000000000001', 'Return visit', 'repeat', 'fixed', 500),
 ('cb140000-0000-4000-8000-000000000003', 'cb110000-0000-4000-8000-000000000001', 'Everyone', 'all', 'fixed', 500),
 ('cb140000-0000-4000-8000-000000000004', 'cb110000-0000-4000-8000-000000000002', 'Other first visit', 'new_customer', 'fixed', 500);

-- Named staff and p_enforce_schedule=false keep the schedule gate out of the way:
-- only the coupon target is under test. Each call uses its own start time so the
-- single staff member never conflicts with an earlier accepted booking.
CREATE FUNCTION pg_temp.book_at(p_facility uuid, p_staff uuid, p_menu uuid, p_user uuid, p_email text, p_coupon uuid, p_start time)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_booking_for_menus_atomic(p_facility, p_staff, p_user, p_menu, p_coupon,
    '2030-01-07', p_start, p_start + interval '30 minutes', 'Synthetic', p_email, NULL, NULL, 1000, 0, 'pending', false, ARRAY[p_menu]);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.book(p_user uuid, p_email text, p_coupon uuid, p_start time) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.book_at('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001',
    'cb120000-0000-4000-8000-000000000001', p_user, p_email, p_coupon, p_start);
$$;
CREATE FUNCTION pg_temp.bookings_of(p_canonical text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.bookings WHERE email_canonical = p_canonical;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_new constant uuid := 'cb140000-0000-4000-8000-000000000001';
  c_repeat constant uuid := 'cb140000-0000-4000-8000-000000000002';
  c_all constant uuid := 'cb140000-0000-4000-8000-000000000003';
  c_other_new constant uuid := 'cb140000-0000-4000-8000-000000000004';
  member constant uuid := 'cb100000-0000-4000-8000-000000000001';
BEGIN
  -- 1. A guest without history may use 新規, and is then a returning customer.
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'first.guest@gmail.com', c_new, '09:00') = 'accepted', 'first booking with a 新規 coupon');
  PERFORM pg_temp.assert_target(
    (SELECT count(*) = 1 FROM public.coupon_redemptions WHERE coupon_id = c_new), 'the accepted 新規 booking is redeemed');
  -- 2. The same guest again, under a Gmail alias (dots, +tag, googlemail): refused, nothing kept.
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'First.Guest+again@googlemail.com', c_new, '09:30') = 'COUPON_NEW_CUSTOMER_ONLY',
    'a guest with history cannot reuse 新規 under an e-mail alias');
  PERFORM pg_temp.assert_target(pg_temp.bookings_of('firstguest@gmail.com') = 1, 'the refused booking is rolled back');
  PERFORM pg_temp.assert_target(
    (SELECT count(*) = 1 FROM public.coupon_redemptions WHERE coupon_id = c_new), 'the refused booking leaves no redemption');
  -- 3. ... but may use リピーター and 全員.
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'firstguest@gmail.com', c_repeat, '10:00') = 'accepted', 'リピーター after a first booking');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'firstguest@gmail.com', c_all, '10:30') = 'accepted', '全員 is not restricted');
  -- 4. A first-time customer cannot use リピーター.
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'never@example.invalid', c_repeat, '11:00') = 'COUPON_REPEAT_ONLY',
    'リピーター needs a previous booking');
  PERFORM pg_temp.assert_target(pg_temp.bookings_of('never@example.invalid') = 0, 'the refused リピーター booking is rolled back');
  -- 5. Cancelled bookings are not history.
  INSERT INTO public.bookings(facility_id, staff_id, menu_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used)
  VALUES ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', 'cb120000-0000-4000-8000-000000000001',
          '2030-01-06', '10:00', '10:30', 'Synthetic', 'cancelled.only@example.invalid', 'cancelled', 1000, 0),
         ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', 'cb120000-0000-4000-8000-000000000001',
          '2030-01-06', '11:00', '11:30', 'Synthetic', 'fee.only@example.invalid', 'cancel_fee_paid', 1000, 0);
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'cancelled.only@example.invalid', c_new, '12:00') = 'accepted',
    'a cancelled booking does not make the customer a returning one');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'fee.only@example.invalid', c_repeat, '12:30') = 'COUPON_REPEAT_ONLY',
    'a cancellation with a fee is not a previous booking either');
  -- 6. A signed-in customer is matched by account even with a different e-mail.
  PERFORM pg_temp.assert_target(pg_temp.book(member, 'old-address@example.invalid', NULL, '13:00') = 'accepted', 'booking without a coupon');
  PERFORM pg_temp.assert_target(pg_temp.book(member, 'new-address@example.invalid', c_new, '13:30') = 'COUPON_NEW_CUSTOMER_ONLY',
    'the account history counts for 新規');
  PERFORM pg_temp.assert_target(pg_temp.book(member, 'new-address@example.invalid', c_repeat, '14:00') = 'accepted',
    'the account history counts for リピーター');
  -- 7. History is per facility.
  PERFORM pg_temp.assert_target(pg_temp.book_at('cb110000-0000-4000-8000-000000000002', 'cb130000-0000-4000-8000-000000000002',
    'cb120000-0000-4000-8000-000000000002', NULL, 'elsewhere@example.invalid', NULL, '09:00') = 'accepted', 'a booking at another facility');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'elsewhere@example.invalid', c_new, '14:30') = 'accepted',
    'another facility''s booking does not count here');
  PERFORM pg_temp.assert_target(pg_temp.book_at('cb110000-0000-4000-8000-000000000002', 'cb130000-0000-4000-8000-000000000002',
    'cb120000-0000-4000-8000-000000000002', NULL, 'elsewhere@example.invalid', c_other_new, '10:00') = 'COUPON_NEW_CUSTOMER_ONLY',
    'but it counts at its own facility');
  -- 8. Bookings without a coupon (manual bookings pass none) are unchanged for returning customers.
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'firstguest@gmail.com', NULL, '15:00') = 'accepted', 'no coupon, no target check');
END $$;
RESET ROLE;

DO $$ DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.assert_target(NOT has_function_privilege(role_name,
      'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE'),
      'public roles cannot call the booking core as ' || role_name);
  END LOOP;
  PERFORM pg_temp.assert_target(has_function_privilege('service_role',
    'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])', 'EXECUTE'),
    'the service role keeps the booking core');
  PERFORM pg_temp.assert_target((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public']
    FROM pg_proc p WHERE p.oid = 'public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])'::regprocedure),
    'SECURITY DEFINER and search_path are unchanged');
END $$;
ROLLBACK;
