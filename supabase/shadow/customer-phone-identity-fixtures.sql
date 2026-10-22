-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- 20261023090000_customer_phone_identity: phone/walk-in bookings without an email are
-- matched by the booking's phone digits (10+ digits, full-width digits folded), never by
-- name. Visits with an email stay keyed by email even when they carry the same phone.
-- Results are facility-scoped and only owner/admin members of that facility see rows.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fc9a0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fc9a0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- The bootstrap stub returns NULL. Emulate the real JWT identity so the reads run
-- under the member's own RLS; ROLLBACK restores the stub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION pg_temp.assert_phone(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'customer phone identity fixture: %', label; END IF; END $$;

-- Normalisation rule (mirrors src/lib/customer-identity.ts phoneDigits).
SELECT pg_temp.assert_phone(
  public.customer_phone_digits('090-1111-2222') = '09011112222'
  AND public.customer_phone_digits('０９０－１１１１－２２２２') = '09011112222'
  AND public.customer_phone_digits('03 (1234) 5678') = '0312345678'
  AND public.customer_phone_digits('1234') IS NULL
  AND public.customer_phone_digits('') IS NULL
  AND public.customer_phone_digits(NULL) IS NULL,
  'phone digits fold full-width digits, drop separators and ignore short numbers');

-- Privilege surface: browser anon cannot execute; members and the service role can.
SELECT pg_temp.assert_phone(
  NOT has_function_privilege('anon', 'public.customer_phone_digits(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_customer_visit_summary(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_customer_phone_visits(uuid,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_customer_visit_summary(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_customer_phone_visits(uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_customer_visit_summary(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_customer_phone_visits(uuid,text)', 'EXECUTE'),
  'anon cannot execute; authenticated and service_role can');
SELECT pg_temp.assert_phone(
  (SELECT bool_and(NOT p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('customer_phone_digits', 'get_customer_visit_summary', 'get_customer_phone_visits')),
  'all three run with the caller''s rights (RLS applies)');

-- Owner of A (01), owner of B only (02).
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fc9a0000-0000-4000-8000-000000000001', 'phone-owner@example.invalid', now()),
  ('fc9a0000-0000-4000-8000-000000000002', 'phone-other@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fc9a0001-0000-4000-8000-000000000001', 'Synthetic phone A', 'synthetic-phone-a', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fc9a0001-0000-4000-8000-000000000002', 'Synthetic phone B', 'synthetic-phone-b', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fc9a0000-0000-4000-8000-000000000001', 'fc9a0001-0000-4000-8000-000000000001', 'owner'),
  ('fc9a0000-0000-4000-8000-000000000002', 'fc9a0001-0000-4000-8000-000000000002', 'owner');

-- A: 01-03 the same phone in three spellings (no email), 04 a short placeholder, 05 neither,
--    06 an email booking that carries the same phone, 07 a blank email with another phone,
--    08 the same phone but not completed. B: 09 the same phone at another facility.
INSERT INTO public.bookings(id, facility_id, booking_date, start_time, end_time, customer_name, email, phone, status, total_price, source) VALUES
  ('fc9a0002-0000-4000-8000-000000000001', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-01', '10:00', '11:00', '電話 花子', NULL, '090-1111-2222', 'confirmed', 1000, 'phone'),
  ('fc9a0002-0000-4000-8000-000000000002', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-02', '10:00', '11:00', '電話 花子', NULL, '09011112222', 'confirmed', 2000, 'phone'),
  ('fc9a0002-0000-4000-8000-000000000003', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-03', '10:00', '11:00', '山田 花子', NULL, '０９０－１１１１－２２２２', 'confirmed', 3000, 'walk_in'),
  ('fc9a0002-0000-4000-8000-000000000004', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-04', '10:00', '11:00', '仮番号', NULL, '1234', 'confirmed', 1000, 'phone'),
  ('fc9a0002-0000-4000-8000-000000000005', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-05', '10:00', '11:00', '連絡先なし', NULL, NULL, 'confirmed', 1000, 'walk_in'),
  ('fc9a0002-0000-4000-8000-000000000006', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-06', '10:00', '11:00', 'メール 太郎', 'Mail.Person+x@gmail.com', '090-1111-2222', 'confirmed', 1000, 'online'),
  ('fc9a0002-0000-4000-8000-000000000007', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-07', '10:00', '11:00', '空欄 次郎', '  ', '090-3333-4444', 'confirmed', 1000, 'phone'),
  ('fc9a0002-0000-4000-8000-000000000008', 'fc9a0001-0000-4000-8000-000000000001', '2030-01-08', '10:00', '11:00', '電話 花子', NULL, '090-1111-2222', 'confirmed', 1000, 'phone'),
  ('fc9a0002-0000-4000-8000-000000000009', 'fc9a0001-0000-4000-8000-000000000002', '2030-01-09', '10:00', '11:00', '別店舗', NULL, '090-1111-2222', 'confirmed', 1000, 'phone');
SET LOCAL ROLE service_role;
UPDATE public.bookings SET status = 'completed'
  WHERE id::text LIKE 'fc9a0002-%' AND id <> 'fc9a0002-0000-4000-8000-000000000008';
RESET ROLE;
SELECT pg_temp.assert_phone(
  (SELECT count(*) = 7 AND count(customer_email) = 2 FROM public.customer_visits
    WHERE facility_id = 'fc9a0001-0000-4000-8000-000000000001'),
  'completed bookings produced visits (email-less ones keep a NULL email)');

-- The owner of A reads A.
SELECT set_config('request.jwt.claim.sub', 'fc9a0000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_phone(
  (SELECT count(*) = 3 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')),
  'one row per person: the phone customer, the email customer and the blank-email phone customer');
SELECT pg_temp.assert_phone(
  (SELECT email IS NULL AND visit_count = 3 AND last_visit = '2030-01-03' AND name = '山田 花子'
     AND phone = '０９０－１１１１－２２２２'
   FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
   WHERE email IS NULL AND public.customer_phone_digits(phone) = '09011112222'),
  'three spellings of one phone are one customer; the latest visit names the row');
SELECT pg_temp.assert_phone(
  (SELECT visit_count = 1 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
   WHERE email = 'Mail.Person+x@gmail.com'),
  'an email visit stays with its email even when it carries the same phone');
SELECT pg_temp.assert_phone(
  (SELECT email IS NULL AND visit_count = 1 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
   WHERE phone = '090-3333-4444'),
  'a blank email falls back to the phone');
SELECT pg_temp.assert_phone(
  NOT EXISTS(SELECT 1 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
   WHERE name IN ('仮番号', '連絡先なし', '別店舗')),
  'short placeholders, contactless visits and other facilities are never merged in');
SELECT pg_temp.assert_phone(
  (SELECT array_agg(s.last_visit ORDER BY s.ord)
   FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
     WITH ORDINALITY AS s(email, phone, name, visit_count, last_visit, ord))
    = ARRAY['2030-01-07', '2030-01-06', '2030-01-03']::date[],
  'newest last visit first');
SELECT pg_temp.assert_phone(
  (SELECT array_agg(booking_id::text ORDER BY visit_date DESC) FROM public.get_customer_phone_visits('fc9a0001-0000-4000-8000-000000000001', '090 1111 2222'))
    = ARRAY['fc9a0002-0000-4000-8000-000000000003', 'fc9a0002-0000-4000-8000-000000000002', 'fc9a0002-0000-4000-8000-000000000001'],
  'phone history returns only the email-less visits of that phone at that facility');
SELECT pg_temp.assert_phone(
  (SELECT count(*) = 0 FROM public.get_customer_phone_visits('fc9a0001-0000-4000-8000-000000000001', '1234'))
  AND (SELECT count(*) = 0 FROM public.get_customer_phone_visits('fc9a0001-0000-4000-8000-000000000001', NULL))
  AND (SELECT count(*) = 0 FROM public.get_customer_phone_visits('fc9a0001-0000-4000-8000-000000000001', '')),
  'an unusable phone never returns the facility''s whole history');
RESET ROLE;

-- Correcting a completion removes the visit from the count.
SET LOCAL ROLE service_role;
UPDATE public.bookings SET status = 'no_show' WHERE id = 'fc9a0002-0000-4000-8000-000000000002';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_phone(
  (SELECT visit_count = 2 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001')
    WHERE email IS NULL AND public.customer_phone_digits(phone) = '09011112222'),
  'a completion corrected to no_show is no longer counted');
RESET ROLE;

-- Another facility's owner sees nothing of A.
SELECT set_config('request.jwt.claim.sub', 'fc9a0000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_phone(
  (SELECT count(*) = 0 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000001'))
  AND (SELECT count(*) = 0 FROM public.get_customer_phone_visits('fc9a0001-0000-4000-8000-000000000001', '09011112222')),
  'non-members read no rows');
SELECT pg_temp.assert_phone(
  (SELECT visit_count = 1 FROM public.get_customer_visit_summary('fc9a0001-0000-4000-8000-000000000002')),
  'the same phone at another facility is that facility''s own customer');
RESET ROLE;
ROLLBACK;
