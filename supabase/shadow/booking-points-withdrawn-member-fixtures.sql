-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023130000_booking_points_withdrawn_member.sql: a member who spent points on a
-- booking and deleted the account before the shop recorded the outcome. The booking
-- keeps points_used and loses user_id (ON DELETE SET NULL); the ledger goes with the
-- account. Before the fix, every status change and every checkout of that booking
-- raised POINTS_AUTH_REQUIRED (500 for the shop, booking could never be closed).
--   * 受付 / 完了 / 無断キャンセル / キャンセル and the completion correction succeed;
--   * checkout without completing and checkout that completes succeed;
--   * none of them writes a user_points row (nothing to refund, award or reverse);
--   * creating a booking that spends points without an account is still refused;
--   * a booking whose ledger rows still exist without an owner is still refused;
--   * a member's own booking still refunds on cancellation (unchanged branch).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fe200000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_withdrawn(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'withdrawn member points fixture failed: %', label; END IF; END $$;

-- 0. The trigger function stays trigger-only.
SELECT pg_temp.assert_withdrawn(NOT has_function_privilege('anon', 'public.sync_booking_points()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sync_booking_points()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.sync_booking_points()', 'EXECUTE'),
  'sync_booking_points is not callable by application roles');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe200000-0000-4000-8000-000000000001', 'withdrawn-owner@example.invalid', now()),
 ('fe200000-0000-4000-8000-000000000002', 'withdrawn-customer@example.invalid', now()),
 ('fe200000-0000-4000-8000-000000000003', 'withdrawn-member@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
 ('fe210000-0000-4000-8000-000000000001', 'Withdrawn member clinic', 'withdrawn-member-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
 ('fe200000-0000-4000-8000-000000000001', 'fe210000-0000-4000-8000-000000000001', 'owner');
INSERT INTO public.user_points(user_id, points, reason) VALUES
 ('fe200000-0000-4000-8000-000000000002', 5000, 'Synthetic seed'),
 ('fe200000-0000-4000-8000-000000000003', 1000, 'Synthetic seed');

-- Bookings that started in the past and are still open (nothing auto-closes them).
-- Each spends 300 points; the insert debits them from the customer's ledger.
INSERT INTO public.bookings(id, facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used) VALUES
 ('fe220000-0000-4000-8000-000000000001', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '09:00', '10:00', 'Synthetic arrived', NULL, 'confirmed', 4700, 300),
 ('fe220000-0000-4000-8000-000000000002', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '10:00', '11:00', 'Synthetic completed', NULL, 'confirmed', 4700, 300),
 ('fe220000-0000-4000-8000-000000000003', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '11:00', '12:00', 'Synthetic no-show', NULL, 'confirmed', 4700, 300),
 ('fe220000-0000-4000-8000-000000000004', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '12:00', '13:00', 'Synthetic cancelled', NULL, 'confirmed', 4700, 300),
 ('fe220000-0000-4000-8000-000000000005', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '13:00', '14:00', 'Synthetic checkout', NULL, 'confirmed', 4700, 300),
 ('fe220000-0000-4000-8000-000000000006', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000002', '2020-01-06', '14:00', '15:00', 'Synthetic arrived checkout', NULL, 'arrived', 4700, 300),
 ('fe220000-0000-4000-8000-000000000007', 'fe210000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000003', '2020-01-06', '15:00', '16:00', 'Synthetic member', NULL, 'confirmed', 700, 300);
SELECT pg_temp.assert_withdrawn((SELECT count(*) = 6 FROM public.user_points
  WHERE user_id = 'fe200000-0000-4000-8000-000000000002' AND booking_operation = 'debit' AND points = -300),
  'each booking debited its points while the account existed');

-- The status change and checkout the shop runs, as /api/admin/booking-status and
-- /api/admin/booking-checkout call them (no e-mail on these bookings: no envelope).
CREATE FUNCTION pg_temp.set_status(p_booking uuid, p_next text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.save_booking_email_event_atomic('fe200000-0000-4000-8000-000000000001', p_booking,
    (SELECT status FROM public.bookings WHERE id = p_booking), (SELECT updated_at FROM public.bookings WHERE id = p_booking),
    p_next, NULL);
  RETURN 'saved';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
END $$;
CREATE FUNCTION pg_temp.checkout(p_booking uuid, p_complete boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.checkout_booking_with_points_atomic('fe200000-0000-4000-8000-000000000001', p_booking,
    (SELECT status FROM public.bookings WHERE id = p_booking), (SELECT updated_at FROM public.bookings WHERE id = p_booking),
    '[{"type":"menu","name":"Synthetic","amount":5000},{"type":"discount","name":"ポイント利用","amount":-300}]'::jsonb,
    5000, p_complete);
  RETURN 'saved';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
END $$;

-- 1. The customer deletes the account. The bookings are in the past, so the active
--    booking guard lets it through (as /api/account/delete does).
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DELETE FROM auth.users WHERE id = 'fe200000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT pg_temp.assert_withdrawn((SELECT bool_and(user_id IS NULL AND points_used = 300) AND count(*) = 6 FROM public.bookings
  WHERE id::text LIKE 'fe220000-0000-4000-8000-00000000000_' AND id <> 'fe220000-0000-4000-8000-000000000007'),
  'the bookings keep points_used and lose user_id');
SELECT pg_temp.assert_withdrawn(NOT EXISTS (SELECT 1 FROM public.user_points WHERE user_id = 'fe200000-0000-4000-8000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.user_points WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id IS NULL
    AND facility_id = 'fe210000-0000-4000-8000-000000000001')),
  'the ledger went with the account');

SET LOCAL ROLE service_role;
DO $$
DECLARE
  arrived constant uuid := 'fe220000-0000-4000-8000-000000000001';
  completed constant uuid := 'fe220000-0000-4000-8000-000000000002';
  no_show constant uuid := 'fe220000-0000-4000-8000-000000000003';
  cancelled constant uuid := 'fe220000-0000-4000-8000-000000000004';
  checkout constant uuid := 'fe220000-0000-4000-8000-000000000005';
  arrived_checkout constant uuid := 'fe220000-0000-4000-8000-000000000006';
  outcome text;
BEGIN
  -- 2. 受付 / 完了 / 無断キャンセル / キャンセル. Before the fix each returned POINTS_AUTH_REQUIRED.
  outcome := pg_temp.set_status(arrived, 'arrived');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', '受付 is saved (got ' || outcome || ')');
  outcome := pg_temp.set_status(arrived, 'completed');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'arrived -> 完了 is saved (got ' || outcome || ')');
  outcome := pg_temp.set_status(completed, 'completed');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', '完了 is saved (got ' || outcome || ')');
  outcome := pg_temp.set_status(completed, 'no_show');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'completion corrected to 無断キャンセル (got ' || outcome || ')');
  outcome := pg_temp.set_status(no_show, 'no_show');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', '無断キャンセル is saved (got ' || outcome || ')');
  outcome := pg_temp.set_status(cancelled, 'cancelled');
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'キャンセル is saved (got ' || outcome || ')');
  PERFORM pg_temp.assert_withdrawn((SELECT status FROM public.bookings WHERE id = arrived) = 'completed'
    AND (SELECT status FROM public.bookings WHERE id = completed) = 'no_show'
    AND (SELECT status FROM public.bookings WHERE id = no_show) = 'no_show'
    AND (SELECT status FROM public.bookings WHERE id = cancelled) = 'cancelled', 'statuses are stored');

  -- 3. 会計: saving the charges without completing, then completing; and from 受付.
  outcome := pg_temp.checkout(checkout, false);
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'checkout without completion is saved (got ' || outcome || ')');
  PERFORM pg_temp.assert_withdrawn((SELECT status = 'confirmed' AND total_price = 4700 AND charges IS NOT NULL
    FROM public.bookings WHERE id = checkout), 'charges saved, booking still open');
  outcome := pg_temp.checkout(checkout, true);
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'checkout that completes is saved (got ' || outcome || ')');
  outcome := pg_temp.checkout(arrived_checkout, true);
  PERFORM pg_temp.assert_withdrawn(outcome = 'saved', 'checkout of an arrived booking completes (got ' || outcome || ')');
  PERFORM pg_temp.assert_withdrawn((SELECT bool_and(status = 'completed') FROM public.bookings WHERE id IN (checkout, arrived_checkout))
    AND (SELECT count(*) = 2 FROM public.customer_visits WHERE booking_id IN (checkout, arrived_checkout)),
    'completed checkouts are stored with their visit');

  -- 4. Nothing was refunded, awarded or reversed for the deleted account.
  PERFORM pg_temp.assert_withdrawn(NOT EXISTS (SELECT 1 FROM public.user_points
    WHERE booking_id IN (arrived, completed, no_show, cancelled, checkout, arrived_checkout)),
    'no user_points rows are written for the withdrawn bookings');
END $$;
RESET ROLE;

-- 5. Unchanged: a booking that spends points still needs an account when it is created.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.bookings(facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used)
      VALUES ('fe210000-0000-4000-8000-000000000001', NULL, '2030-01-07', '09:00', '10:00', 'Synthetic guest', NULL, 'confirmed', 4700, 300);
    RAISE EXCEPTION 'guest booking spending points accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'POINTS_AUTH_REQUIRED' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_withdrawn(NOT EXISTS (SELECT 1 FROM public.bookings WHERE customer_name = 'Synthetic guest'),
    'the refused guest booking is not stored');
END $$;

-- 6. Unchanged: ledger rows that still point at a booking without an account keep the
--    refusal (the owner cannot be resolved; never refund or reverse by guesswork).
--    No path in the application or the migrations does this; the fixture forces it.
UPDATE public.bookings SET user_id = NULL WHERE id = 'fe220000-0000-4000-8000-000000000007';
SELECT pg_temp.assert_withdrawn(EXISTS (SELECT 1 FROM public.user_points
  WHERE booking_id = 'fe220000-0000-4000-8000-000000000007' AND booking_operation = 'debit'), 'orphaned ledger row exists');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_withdrawn(pg_temp.set_status('fe220000-0000-4000-8000-000000000007', 'cancelled') = 'POINTS_AUTH_REQUIRED',
  'a booking whose ledger rows remain without an owner is still refused');
SELECT pg_temp.assert_withdrawn(pg_temp.checkout('fe220000-0000-4000-8000-000000000007', false) = 'POINTS_AUTH_REQUIRED',
  'its checkout is still refused');
RESET ROLE;

-- 7. Unchanged: a member's own booking still refunds the points on cancellation.
UPDATE public.bookings SET user_id = 'fe200000-0000-4000-8000-000000000003' WHERE id = 'fe220000-0000-4000-8000-000000000007';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_withdrawn(pg_temp.set_status('fe220000-0000-4000-8000-000000000007', 'cancelled') = 'saved',
  'a member booking is cancelled');
RESET ROLE;
SELECT pg_temp.assert_withdrawn((SELECT points = 300 FROM public.user_points
  WHERE booking_id = 'fe220000-0000-4000-8000-000000000007' AND booking_operation = 'refund'), 'the member gets the points back');

SELECT 'withdrawn member points booking: status changes and checkout succeed without ledger writes';
ROLLBACK;
