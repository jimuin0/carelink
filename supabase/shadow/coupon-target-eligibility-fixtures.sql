-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- Coupon target 新規 (new_customer) / リピーター (repeat) enforced by
-- create_booking_for_menus_atomic (20261022160000_coupon_target_eligibility.sql):
--   * a guest gets COUPON_TARGET_LOGIN_REQUIRED whatever address is typed, so the
--     answer never depends on someone else's history;
--   * a signed-in customer is judged only by the account's own history: bookings
--     of the account, and bookings under the account's confirmed e-mail
--     (canonicalised like bookings.email_canonical). The typed e-mail is ignored;
--   * 新規 = no booking here that was not cancelled; リピーター = a visit here
--     (arrived / completed);
--   * a refusal leaves no booking and no redemption.
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
 -- Account e-mail is a Gmail alias of an earlier guest booking (see history below).
 ('cb100000-0000-4000-8000-000000000001', 'Alias.Owner@googlemail.com', now()),
 -- Unconfirmed account e-mail: never used for the lookup.
 ('cb100000-0000-4000-8000-000000000002', 'unconfirmed@example.invalid', NULL),
 ('cb100000-0000-4000-8000-000000000003', 'fresh@example.invalid', now()),
 ('cb100000-0000-4000-8000-000000000004', 'cancelled-only@example.invalid', now()),
 ('cb100000-0000-4000-8000-000000000005', 'no-show@example.invalid', now());
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

-- Earlier history at the clinic (2030-01-06), written directly.
INSERT INTO public.bookings(facility_id, staff_id, user_id, menu_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used) VALUES
 -- A guest visit under a Gmail alias of account 1's e-mail.
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', NULL, 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '09:00', '09:30', 'Synthetic', 'aliasowner+2029@gmail.com', 'completed', 1000, 0),
 -- A guest visit under account 2's unconfirmed e-mail.
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', NULL, 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '09:30', '10:00', 'Synthetic', 'unconfirmed@example.invalid', 'completed', 1000, 0),
 -- Account 4 only cancelled.
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000004', 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '10:00', '10:30', 'Synthetic', 'cancelled-only@example.invalid', 'cancelled', 1000, 0),
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000004', 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '10:30', '11:00', 'Synthetic', 'cancelled-only@example.invalid', 'cancel_fee_paid', 1000, 0),
 -- Account 5 booked but did not come.
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000005', 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '11:00', '11:30', 'Synthetic', 'no-show@example.invalid', 'no_show', 1000, 0),
 -- Someone else's visit: the address a third party might type into the form.
 ('cb110000-0000-4000-8000-000000000001', 'cb130000-0000-4000-8000-000000000001', NULL, 'cb120000-0000-4000-8000-000000000001',
  '2030-01-06', '11:30', '12:00', 'Synthetic', 'victim@example.invalid', 'completed', 1000, 0);
SELECT pg_temp.assert_target((SELECT email_canonical = 'aliasowner@gmail.com' FROM public.bookings WHERE email = 'aliasowner+2029@gmail.com'),
  'the guest alias canonicalises to the account address');

-- Named staff and p_enforce_schedule=false keep the schedule gate out of the way:
-- only the coupon target is under test. Each call uses its own start time on
-- 2030-01-07 so the single staff member never conflicts with an accepted booking.
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
CREATE FUNCTION pg_temp.new_bookings() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.bookings WHERE facility_id = 'cb110000-0000-4000-8000-000000000001' AND booking_date = '2030-01-07';
$$;
CREATE FUNCTION pg_temp.redemptions(p_coupon uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.coupon_redemptions WHERE coupon_id = p_coupon;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_new constant uuid := 'cb140000-0000-4000-8000-000000000001';
  c_repeat constant uuid := 'cb140000-0000-4000-8000-000000000002';
  c_all constant uuid := 'cb140000-0000-4000-8000-000000000003';
  fresh constant uuid := 'cb100000-0000-4000-8000-000000000003';
BEGIN
  -- 1. A guest cannot use 新規 / リピーター, and the answer is the same whether
  --    the typed address has history or not (no lookup of someone else's visits).
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'victim@example.invalid', c_new, '09:00') = 'COUPON_TARGET_LOGIN_REQUIRED',
    'guest 新規 with an address that has history');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'nobody@example.invalid', c_new, '09:00') = 'COUPON_TARGET_LOGIN_REQUIRED',
    'guest 新規 with an address without history');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'victim@example.invalid', c_repeat, '09:00') = 'COUPON_TARGET_LOGIN_REQUIRED',
    'guest リピーター with an address that has history');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'nobody@example.invalid', c_repeat, '09:00') = 'COUPON_TARGET_LOGIN_REQUIRED',
    'guest リピーター with an address without history');
  PERFORM pg_temp.assert_target(pg_temp.new_bookings() = 0 AND pg_temp.redemptions(c_new) = 0 AND pg_temp.redemptions(c_repeat) = 0,
    'refused guest bookings leave nothing');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'nobody@example.invalid', c_all, '09:00') = 'accepted', 'a guest may still use 全員');

  -- 2. The typed address is never used: a new account typing someone else's
  --    address is judged by its own (empty) history.
  PERFORM pg_temp.assert_target(pg_temp.book(fresh, 'victim@example.invalid', c_new, '09:30') = 'accepted',
    'someone else''s visits behind the typed address do not refuse 新規');
  PERFORM pg_temp.assert_target(pg_temp.redemptions(c_new) = 1, 'the accepted 新規 booking is redeemed');
  PERFORM pg_temp.assert_target(pg_temp.book(fresh, 'victim@example.invalid', c_repeat, '10:00') = 'COUPON_REPEAT_ONLY',
    'someone else''s visits behind the typed address do not allow リピーター');

  -- 3. The account's own booking counts for 新規, and the refusal is rolled back.
  PERFORM pg_temp.assert_target(pg_temp.book(fresh, 'fresh@example.invalid', c_new, '10:30') = 'COUPON_NEW_CUSTOMER_ONLY',
    'a second booking cannot use 新規 again');
  PERFORM pg_temp.assert_target((SELECT count(*) = 1 FROM public.bookings WHERE user_id = fresh), 'the refused 新規 booking is rolled back');
  PERFORM pg_temp.assert_target(pg_temp.redemptions(c_new) = 1, 'the refused 新規 booking leaves no redemption');
END $$;

-- 4. A booking that has not been visited yet is not a visit; arrived is.
RESET ROLE;
UPDATE public.bookings SET status = 'arrived' WHERE user_id = 'cb100000-0000-4000-8000-000000000003';
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_new constant uuid := 'cb140000-0000-4000-8000-000000000001';
  c_repeat constant uuid := 'cb140000-0000-4000-8000-000000000002';
  c_other_new constant uuid := 'cb140000-0000-4000-8000-000000000004';
  alias_owner constant uuid := 'cb100000-0000-4000-8000-000000000001';
  unconfirmed constant uuid := 'cb100000-0000-4000-8000-000000000002';
  fresh constant uuid := 'cb100000-0000-4000-8000-000000000003';
  cancelled_only constant uuid := 'cb100000-0000-4000-8000-000000000004';
  no_show constant uuid := 'cb100000-0000-4000-8000-000000000005';
BEGIN
  PERFORM pg_temp.assert_target(pg_temp.book(fresh, 'fresh@example.invalid', c_repeat, '11:00') = 'accepted',
    'リピーター after an arrived visit');

  -- 5. Guest visits under the account's confirmed e-mail (a Gmail alias of it) are the account's history.
  PERFORM pg_temp.assert_target(pg_temp.book(alias_owner, 'typed-anything@example.invalid', c_new, '11:30') = 'COUPON_NEW_CUSTOMER_ONLY',
    'a guest visit under the account e-mail refuses 新規');
  PERFORM pg_temp.assert_target(pg_temp.book(alias_owner, 'typed-anything@example.invalid', c_repeat, '12:00') = 'accepted',
    'a guest visit under the account e-mail allows リピーター');

  -- 6. An unconfirmed account e-mail is not used.
  PERFORM pg_temp.assert_target(pg_temp.book(unconfirmed, 'unconfirmed@example.invalid', c_repeat, '12:30') = 'COUPON_REPEAT_ONLY',
    'visits under an unconfirmed account e-mail do not count');
  PERFORM pg_temp.assert_target(pg_temp.book(unconfirmed, 'unconfirmed@example.invalid', c_new, '13:00') = 'accepted',
    'nor do they refuse 新規');

  -- 7. Cancelled bookings are neither history nor visits.
  PERFORM pg_temp.assert_target(pg_temp.book(cancelled_only, 'cancelled-only@example.invalid', c_repeat, '13:30') = 'COUPON_REPEAT_ONLY',
    'cancellations are not visits');
  PERFORM pg_temp.assert_target(pg_temp.book(cancelled_only, 'cancelled-only@example.invalid', c_new, '14:00') = 'accepted',
    'cancellations do not make a returning customer');

  -- 8. A no-show was a booking (新規 refused) but not a visit (リピーター refused).
  PERFORM pg_temp.assert_target(pg_temp.book(no_show, 'no-show@example.invalid', c_new, '14:30') = 'COUPON_NEW_CUSTOMER_ONLY',
    'a no-show booking counts for 新規');
  PERFORM pg_temp.assert_target(pg_temp.book(no_show, 'no-show@example.invalid', c_repeat, '15:00') = 'COUPON_REPEAT_ONLY',
    'a no-show is not a visit');

  -- 9. History is per facility.
  PERFORM pg_temp.assert_target(pg_temp.book_at('cb110000-0000-4000-8000-000000000002', 'cb130000-0000-4000-8000-000000000002',
    'cb120000-0000-4000-8000-000000000002', fresh, 'fresh@example.invalid', c_other_new, '09:00') = 'accepted',
    'history at another facility does not count');

  -- 10. Bookings without a coupon (manual bookings pass none) are unchanged.
  PERFORM pg_temp.assert_target(pg_temp.book(fresh, 'fresh@example.invalid', NULL, '15:30') = 'accepted', 'signed in, no coupon');
  PERFORM pg_temp.assert_target(pg_temp.book(NULL, 'victim@example.invalid', NULL, '16:00') = 'accepted', 'guest, no coupon');

  PERFORM pg_temp.assert_target(pg_temp.redemptions(c_new) = 3 AND pg_temp.redemptions(c_repeat) = 2,
    'only accepted coupon bookings are redeemed');
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
