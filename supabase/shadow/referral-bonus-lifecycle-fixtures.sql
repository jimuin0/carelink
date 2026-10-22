-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- Referral bonus lifecycle:
--   * 20261023010000_referral_bonus_lifecycle.sql
--     - a referrer who deleted the account no longer blocks the referred
--       customer's 300pt (the referrer's 500pt is skipped) and the settled bonus
--       is not retried;
--     - a completed visit corrected to no_show compensates both bonuses when no
--       completed visit is left, reopens the claim, and a later genuine first
--       visit grants them again; another completed visit keeps the bonus;
--   * 20261023010100_referral_code_before_first_visit.sql
--     - a customer with a completed visit cannot apply a code
--       (REFERRAL_NOT_ELIGIBLE, nothing written); an existing application still
--       replays.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fd210000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_referral(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'referral lifecycle fixture failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.balance(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum(points), 0) FROM public.user_points WHERE user_id = p_user $$;
CREATE FUNCTION pg_temp.reason_total(p_user uuid, p_reason text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum(points), 0) FROM public.user_points WHERE user_id = p_user AND reason = p_reason $$;

SELECT pg_temp.assert_referral(
  NOT has_function_privilege('anon', 'public.lock_booking_account_if_present(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.lock_booking_account_if_present(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.lock_booking_account_if_present(uuid)', 'EXECUTE'),
  'presence lock is server-only');
SELECT pg_temp.assert_referral(
  NOT has_function_privilege('anon', 'public.reverse_referral_points_without_visit(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.reverse_referral_points_without_visit(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.reverse_referral_points_without_visit(uuid)', 'EXECUTE'),
  'bonus reversal is reachable only from the booking points trigger');

-- 001 owner, 002 referrer, 003 referred, 004 already visited,
-- 005 referrer who deletes the account, 006 referred by 005.
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fd210000-0000-4000-8000-000000000001', 'lifecycle-owner@example.invalid', now()),
 ('fd210000-0000-4000-8000-000000000002', 'lifecycle-referrer@example.invalid', now()),
 ('fd210000-0000-4000-8000-000000000003', 'lifecycle-referred@example.invalid', now()),
 ('fd210000-0000-4000-8000-000000000004', 'lifecycle-visited@example.invalid', now()),
 ('fd210000-0000-4000-8000-000000000005', 'lifecycle-leaving@example.invalid', now()),
 ('fd210000-0000-4000-8000-000000000006', 'lifecycle-orphaned@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('fd220000-0000-4000-8000-000000000001', 'Referral lifecycle synthetic', 'referral-lifecycle-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('fd210000-0000-4000-8000-000000000001', 'fd220000-0000-4000-8000-000000000001', 'owner');
INSERT INTO public.referral_codes(user_id, code, used_count) VALUES
 ('fd210000-0000-4000-8000-000000000002', 'LCYCLAAA', 0),
 ('fd210000-0000-4000-8000-000000000005', 'LCYCLDDD', 0);

SET LOCAL ROLE service_role;
-- 001-003 referred customer, 004 already visited customer, 005 customer of the leaving referrer.
INSERT INTO public.bookings(id, facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used) VALUES
 ('fd230000-0000-4000-8000-000000000001', 'fd220000-0000-4000-8000-000000000001', 'fd210000-0000-4000-8000-000000000003', '2030-01-07', '10:00', '11:00', 'Synthetic', NULL, 'confirmed', 0, 0),
 ('fd230000-0000-4000-8000-000000000002', 'fd220000-0000-4000-8000-000000000001', 'fd210000-0000-4000-8000-000000000003', '2030-01-07', '11:00', '12:00', 'Synthetic', NULL, 'confirmed', 0, 0),
 ('fd230000-0000-4000-8000-000000000003', 'fd220000-0000-4000-8000-000000000001', 'fd210000-0000-4000-8000-000000000003', '2030-01-07', '12:00', '13:00', 'Synthetic', NULL, 'confirmed', 0, 0),
 ('fd230000-0000-4000-8000-000000000004', 'fd220000-0000-4000-8000-000000000001', 'fd210000-0000-4000-8000-000000000004', '2030-01-07', '13:00', '14:00', 'Synthetic', NULL, 'confirmed', 0, 0),
 ('fd230000-0000-4000-8000-000000000005', 'fd220000-0000-4000-8000-000000000001', 'fd210000-0000-4000-8000-000000000006', '2030-01-07', '14:00', '15:00', 'Synthetic', NULL, 'confirmed', 0, 0);

-- Code before the first visit: accepted. After a completed visit: refused, nothing written.
SELECT pg_temp.assert_referral((SELECT NOT replayed FROM public.apply_referral_code_atomic('fd210000-0000-4000-8000-000000000003', 'lcyclaaa')),
  'a customer without a completed visit can apply a code');
SELECT * FROM public.complete_booking_with_points_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000004', 'confirmed');
DO $$ BEGIN
  BEGIN
    PERFORM public.apply_referral_code_atomic('fd210000-0000-4000-8000-000000000004', 'LCYCLAAA');
    RAISE EXCEPTION 'code accepted after the first visit';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'REFERRAL_NOT_ELIGIBLE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_referral(
    NOT EXISTS (SELECT 1 FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000004')
    AND (SELECT used_count = 1 FROM public.referral_codes WHERE code = 'LCYCLAAA'),
    'refusal writes no use and no count');
END $$;

-- First visit grants both bonuses.
SELECT * FROM public.complete_booking_with_points_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000001', 'confirmed');
SELECT pg_temp.assert_referral(public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000003'), 'first completed visit grants the bonus');
SELECT pg_temp.assert_referral(
  pg_temp.balance('fd210000-0000-4000-8000-000000000002') = 500
  AND pg_temp.balance('fd210000-0000-4000-8000-000000000003') = 300
  AND (SELECT points_awarded FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000003'),
  'referrer 500 and customer 300 granted once');
SELECT pg_temp.assert_referral((SELECT replayed FROM public.apply_referral_code_atomic('fd210000-0000-4000-8000-000000000003', 'LCYCLAAA')),
  'the existing application still replays after the visit');

-- The only completed visit is corrected to no_show: both bonuses are compensated, history kept.
SELECT * FROM public.save_booking_email_event_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000001', 'completed',
  (SELECT updated_at FROM public.bookings WHERE id = 'fd230000-0000-4000-8000-000000000001'), 'no_show', NULL);
SELECT pg_temp.assert_referral(
  pg_temp.balance('fd210000-0000-4000-8000-000000000002') = 0
  AND pg_temp.balance('fd210000-0000-4000-8000-000000000003') = 0
  AND pg_temp.reason_total('fd210000-0000-4000-8000-000000000002', '紹介ボーナス') = 500
  AND pg_temp.reason_total('fd210000-0000-4000-8000-000000000002', '紹介ボーナス取消') = -500
  AND pg_temp.reason_total('fd210000-0000-4000-8000-000000000003', '紹介コード利用ボーナス') = 300
  AND pg_temp.reason_total('fd210000-0000-4000-8000-000000000003', '紹介コード利用ボーナス取消') = -300
  AND (SELECT points_awarded = false FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000003'),
  'reversing the only completed visit reverses both bonuses and reopens the claim');
SELECT pg_temp.assert_referral(NOT public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000003'), 'no completed visit, no bonus');

-- A later genuine first visit grants again; a second visit does not grant twice.
SELECT * FROM public.complete_booking_with_points_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000002', 'confirmed');
SELECT pg_temp.assert_referral(public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000003'), 'a later genuine first visit grants again');
SELECT * FROM public.complete_booking_with_points_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000003', 'confirmed');
SELECT pg_temp.assert_referral(NOT public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000003'), 'a second visit does not grant twice');
SELECT pg_temp.assert_referral(
  pg_temp.balance('fd210000-0000-4000-8000-000000000002') = 500
  AND pg_temp.balance('fd210000-0000-4000-8000-000000000003') = 300,
  're-granted bonus is 500 + 300');

-- Another completed visit remains: correcting one visit keeps the bonus.
SELECT * FROM public.save_booking_email_event_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000002', 'completed',
  (SELECT updated_at FROM public.bookings WHERE id = 'fd230000-0000-4000-8000-000000000002'), 'no_show', NULL);
SELECT pg_temp.assert_referral(
  pg_temp.balance('fd210000-0000-4000-8000-000000000002') = 500
  AND pg_temp.balance('fd210000-0000-4000-8000-000000000003') = 300
  AND (SELECT points_awarded FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000003'),
  'a remaining completed visit keeps the bonus');

-- The referrer deletes the account, then the last completed visit is corrected:
-- the deleted referrer is skipped (no lock failure), the customer is compensated.
RESET ROLE;
DELETE FROM auth.users WHERE id = 'fd210000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT * FROM public.save_booking_email_event_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000003', 'completed',
  (SELECT updated_at FROM public.bookings WHERE id = 'fd230000-0000-4000-8000-000000000003'), 'no_show', NULL);
SELECT pg_temp.assert_referral(
  NOT EXISTS (SELECT 1 FROM public.user_points WHERE user_id = 'fd210000-0000-4000-8000-000000000002')
  AND pg_temp.balance('fd210000-0000-4000-8000-000000000003') = 0
  AND (SELECT points_awarded = false FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000003'),
  'deleted referrer is skipped and the customer bonus is compensated');

-- The referrer leaves between the code and the first visit: the customer still
-- receives 300pt once, and the settled bonus is not retried.
SELECT pg_temp.assert_referral((SELECT NOT replayed FROM public.apply_referral_code_atomic('fd210000-0000-4000-8000-000000000006', 'LCYCLDDD')),
  'customer applies before the referrer leaves');
RESET ROLE;
DELETE FROM auth.users WHERE id = 'fd210000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_referral(NOT public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000006'),
  'deleted referrer does not raise before the first visit');
SELECT * FROM public.complete_booking_with_points_atomic('fd210000-0000-4000-8000-000000000001', 'fd230000-0000-4000-8000-000000000005', 'confirmed');
SELECT pg_temp.assert_referral(public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000006'),
  'deleted referrer no longer blocks the customer bonus');
SELECT pg_temp.assert_referral(
  pg_temp.balance('fd210000-0000-4000-8000-000000000006') = 300
  AND NOT EXISTS (SELECT 1 FROM public.user_points WHERE user_id = 'fd210000-0000-4000-8000-000000000005')
  AND (SELECT points_awarded FROM public.referral_uses WHERE referred_user_id = 'fd210000-0000-4000-8000-000000000006'),
  'customer receives 300 only, referrer skipped, bonus settled');
SELECT pg_temp.assert_referral(NOT public.award_referral_points_atomic('fd210000-0000-4000-8000-000000000006'),
  'a settled bonus is not retried');
RESET ROLE;
ROLLBACK;
