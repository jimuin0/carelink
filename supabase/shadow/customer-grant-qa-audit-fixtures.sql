-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- Asserts the state after 20261022210000..20261022210300:
--   * 回数券・月額プランの付与は service_role の RPC だけ。付与先はその店舗の予約者
--     （bookings.user_id）に限り、一覧の表示名・メールも予約者の分しか返さない。
--     ブラウザのロールは user_subscriptions / user_packages を読めるが書けない。
--   * 施設 Q&A はブラウザのロールから一切書けない（質問は /api/facility/qa が service_role で
--     保存し、回答・公開・削除は /api/admin/qa の RPC だけ）。回答待ちの質問は公開されない。
--   * audit_logs はブラウザのロールから読めず、ポリシーも残っていない。
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fb8a0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fb8a0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- The bootstrap stub returns NULL. Emulate the real JWT identity so a direct
-- write is attempted as the member itself; ROLLBACK restores the stub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION pg_temp.assert_scope(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'grant/qa/audit fixture: %', label; END IF; END $$;

-- 01 owner of A, 02 admin of A, 03 staff of A, 04 customer of A (has a booking at A),
-- 05 stranger (booked only at B), 06 owner of B.
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fb8a0000-0000-4000-8000-000000000001', 'grant-owner@example.invalid', now()),
  ('fb8a0000-0000-4000-8000-000000000002', 'grant-admin@example.invalid', now()),
  ('fb8a0000-0000-4000-8000-000000000003', 'grant-staff@example.invalid', now()),
  ('fb8a0000-0000-4000-8000-000000000004', 'grant-customer@example.invalid', now()),
  ('fb8a0000-0000-4000-8000-000000000005', 'grant-stranger@example.invalid', now()),
  ('fb8a0000-0000-4000-8000-000000000006', 'grant-other-owner@example.invalid', now());
UPDATE public.profiles SET display_name = 'Synthetic customer' WHERE id = 'fb8a0000-0000-4000-8000-000000000004';
UPDATE public.profiles SET display_name = 'Synthetic stranger' WHERE id = 'fb8a0000-0000-4000-8000-000000000005';
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fb8a0001-0000-4000-8000-000000000001', 'Synthetic grant A', 'synthetic-grant-a', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fb8a0001-0000-4000-8000-000000000002', 'Synthetic grant B', 'synthetic-grant-b', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fb8a0000-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001', 'owner'),
  ('fb8a0000-0000-4000-8000-000000000002', 'fb8a0001-0000-4000-8000-000000000001', 'admin'),
  ('fb8a0000-0000-4000-8000-000000000003', 'fb8a0001-0000-4000-8000-000000000001', 'staff'),
  ('fb8a0000-0000-4000-8000-000000000006', 'fb8a0001-0000-4000-8000-000000000002', 'owner');
INSERT INTO public.bookings(id, facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status, total_price, points_used) VALUES
  ('fb8a0002-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
   '2030-01-07', '10:00', '11:00', 'Synthetic customer', NULL, 'confirmed', 0, 0),
  ('fb8a0002-0000-4000-8000-000000000002', 'fb8a0001-0000-4000-8000-000000000002', 'fb8a0000-0000-4000-8000-000000000005',
   '2030-01-07', '10:00', '11:00', 'Synthetic stranger', NULL, 'confirmed', 0, 0);
INSERT INTO public.subscription_plans(id, facility_id, name, price, valid_months) VALUES
  ('fb8a0003-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001', 'Synthetic plan A', 1000, 3),
  ('fb8a0003-0000-4000-8000-000000000002', 'fb8a0001-0000-4000-8000-000000000002', 'Synthetic plan B', 1000, 1);
INSERT INTO public.service_packages(id, facility_id, name, session_count, bonus_count, valid_days) VALUES
  ('fb8a0004-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001', 'Synthetic package A', 5, 1, 30),
  ('fb8a0004-0000-4000-8000-000000000002', 'fb8a0001-0000-4000-8000-000000000002', 'Synthetic package B', 5, 0, 30);

-- ---------------------------------------------------------------------------
-- 回数券・月額プランの付与
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_scope(
  NOT has_function_privilege('anon', 'public.grant_user_subscription_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.grant_user_subscription_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.grant_user_package_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.grant_user_package_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_facility_customer_profiles(uuid,uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.list_facility_customer_profiles(uuid,uuid,uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.grant_user_subscription_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.grant_user_package_atomic(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.list_facility_customer_profiles(uuid,uuid,uuid[])', 'EXECUTE'),
  'grant and list RPCs are service_role only');
SELECT pg_temp.assert_scope(
  NOT has_any_column_privilege('anon', 'public.user_subscriptions', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.user_subscriptions', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.user_subscriptions', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.user_subscriptions', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.user_subscriptions', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.user_subscriptions', 'DELETE')
  AND NOT has_any_column_privilege('anon', 'public.user_packages', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.user_packages', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.user_packages', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.user_packages', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.user_packages', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.user_packages', 'DELETE')
  AND has_table_privilege('authenticated', 'public.user_subscriptions', 'SELECT')
  AND has_table_privilege('authenticated', 'public.user_packages', 'SELECT'),
  'browser roles read subscriptions and packages and cannot write them');
SELECT pg_temp.assert_scope(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_subscriptions')
    = ARRAY['user_subscriptions_admin_read', 'user_subscriptions_own']
  AND (SELECT bool_and(cmd = 'SELECT') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_subscriptions')
  AND (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_packages')
    = ARRAY['user_packages_facility_read', 'user_packages_own_read']
  AND (SELECT bool_and(cmd = 'SELECT') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_packages'),
  'only read policies remain on subscriptions and packages');

SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; n int; BEGIN
  -- The facility's own customer receives the plan; the term follows the plan.
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0003-0000-4000-8000-000000000001', 'Synthetic note');
  PERFORM pg_temp.assert_scope((r->>'ok')::boolean
    AND r->'subscription'->>'user_id' = 'fb8a0000-0000-4000-8000-000000000004'
    AND r->'subscription'->>'facility_id' = 'fb8a0001-0000-4000-8000-000000000001'
    AND r->'subscription'->>'notes' = 'Synthetic note'
    AND (r->'subscription'->>'ends_at')::timestamptz > now() + interval '2 months', 'owner grants a plan to a customer');

  -- Somebody who never booked at A (but booked elsewhere) cannot be named.
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000005',
    'fb8a0003-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "not_customer"}'::jsonb, 'stranger plan grant refused');
  -- A non-existent account looks the same as a non-customer.
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-0000000000ff',
    'fb8a0003-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "not_customer"}'::jsonb, 'unknown account plan grant refused');
  -- Another facility's plan cannot be used.
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0003-0000-4000-8000-000000000002');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "plan_not_found"}'::jsonb, 'foreign plan refused');
  -- Staff and members of another facility cannot grant.
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000003',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0003-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "forbidden"}'::jsonb, 'staff plan grant refused');
  r := public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000006',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0003-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "forbidden"}'::jsonb, 'other facility owner plan grant refused');
  BEGIN
    PERFORM public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
      'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
      'fb8a0003-0000-4000-8000-000000000001', repeat('x', 201));
    RAISE EXCEPTION 'over-long plan note accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'CUSTOMER_GRANT_INVALID' THEN RAISE; END IF;
  END;

  -- Packages follow the same rules; the admin role may grant.
  r := public.grant_user_package_atomic('fb8a0000-0000-4000-8000-000000000002',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0004-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope((r->>'ok')::boolean
    AND r->'user_package'->>'user_id' = 'fb8a0000-0000-4000-8000-000000000004'
    AND (r->'user_package'->>'sessions_total')::int = 6
    AND (r->'user_package'->>'sessions_remaining')::int = 6
    AND (r->'user_package'->>'expires_at')::timestamptz BETWEEN now() + interval '29 days' AND now() + interval '31 days',
    'admin grants a package to a customer');
  r := public.grant_user_package_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000005',
    'fb8a0004-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "not_customer"}'::jsonb, 'stranger package grant refused');
  r := public.grant_user_package_atomic('fb8a0000-0000-4000-8000-000000000001',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0004-0000-4000-8000-000000000002');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "package_not_found"}'::jsonb, 'foreign package refused');
  r := public.grant_user_package_atomic('fb8a0000-0000-4000-8000-000000000006',
    'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004',
    'fb8a0004-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_scope(r = '{"ok": false, "code": "forbidden"}'::jsonb, 'other facility owner package grant refused');

  SELECT count(*) INTO n FROM public.user_subscriptions WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_scope(n = 1, 'refused plan grants wrote nothing');
  SELECT count(*) INTO n FROM public.user_packages WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_scope(n = 1, 'refused package grants wrote nothing');

  -- Names and addresses only for the facility's own customers, and only to its owner/admin.
  PERFORM pg_temp.assert_scope((SELECT array_agg(p.email ORDER BY p.email) FROM public.list_facility_customer_profiles(
    'fb8a0000-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001',
    ARRAY['fb8a0000-0000-4000-8000-000000000004', 'fb8a0000-0000-4000-8000-000000000005']::uuid[]) p)
    = ARRAY['grant-customer@example.invalid'], 'list returns the customer and not the stranger');
  PERFORM pg_temp.assert_scope((SELECT display_name FROM public.list_facility_customer_profiles(
    'fb8a0000-0000-4000-8000-000000000002', 'fb8a0001-0000-4000-8000-000000000001',
    ARRAY['fb8a0000-0000-4000-8000-000000000004']::uuid[])) = 'Synthetic customer', 'admin sees the customer name');
  SELECT count(*) INTO n FROM public.list_facility_customer_profiles('fb8a0000-0000-4000-8000-000000000006',
    'fb8a0001-0000-4000-8000-000000000001', ARRAY['fb8a0000-0000-4000-8000-000000000004']::uuid[]);
  PERFORM pg_temp.assert_scope(n = 0, 'another facility owner cannot list A customers');
  SELECT count(*) INTO n FROM public.list_facility_customer_profiles('fb8a0000-0000-4000-8000-000000000003',
    'fb8a0001-0000-4000-8000-000000000001', ARRAY['fb8a0000-0000-4000-8000-000000000004']::uuid[]);
  PERFORM pg_temp.assert_scope(n = 0, 'staff cannot list customers');
END $$;
RESET ROLE;

-- Direct browser writes fail even for the owner; the owner still reads the facility's rows.
SELECT set_config('request.jwt.claim.sub', 'fb8a0000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
  PERFORM pg_temp.assert_scope(auth.uid() = 'fb8a0000-0000-4000-8000-000000000001', 'synthetic JWT identity applied');
  BEGIN
    INSERT INTO public.user_subscriptions(user_id, facility_id, plan_id)
      VALUES ('fb8a0000-0000-4000-8000-000000000005', 'fb8a0001-0000-4000-8000-000000000001', 'fb8a0003-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'direct subscription INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.user_subscriptions SET status = 'cancelled' WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct subscription UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.user_packages(user_id, facility_id, package_id, sessions_total, sessions_remaining)
      VALUES ('fb8a0000-0000-4000-8000-000000000005', 'fb8a0001-0000-4000-8000-000000000001', 'fb8a0004-0000-4000-8000-000000000001', 9, 9);
    RAISE EXCEPTION 'direct package INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.user_packages SET sessions_remaining = 0 WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct package UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.grant_user_subscription_atomic('fb8a0000-0000-4000-8000-000000000001',
      'fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000004', 'fb8a0003-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'browser role executed the grant RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'permission denied%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.user_subscriptions WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_scope(n = 1, 'owner still reads the facility subscriptions');
  SELECT count(*) INTO n FROM public.user_packages WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_scope(n = 1, 'owner still reads the facility packages');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'fb8a0000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_scope((SELECT count(*) = 1 FROM public.user_subscriptions)
  AND (SELECT count(*) = 1 FROM public.user_packages), 'the customer reads only their own rows');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 施設 Q&A
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_scope(
  NOT has_any_column_privilege('anon', 'public.facility_qa', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.facility_qa', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.facility_qa', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.facility_qa', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.facility_qa', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.facility_qa', 'DELETE')
  AND has_table_privilege('anon', 'public.facility_qa', 'SELECT')
  AND has_table_privilege('authenticated', 'public.facility_qa', 'SELECT'),
  'browser roles read Q&A and cannot write it');
SELECT pg_temp.assert_scope(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'facility_qa')
    = ARRAY['facility_qa_member_read', 'facility_qa_public_read']
  AND (SELECT bool_and(cmd = 'SELECT') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'facility_qa'),
  'only read policies remain on Q&A');

-- The server stores a visitor question as the API does.
SET LOCAL ROLE service_role;
INSERT INTO public.facility_qa(id, facility_id, user_id, question, status, is_public) VALUES
  ('fb8a0005-0000-4000-8000-000000000001', 'fb8a0001-0000-4000-8000-000000000001',
   'fb8a0000-0000-4000-8000-000000000004', 'Synthetic pending question', 'pending', true);
RESET ROLE;

-- A visitor cannot publish a forged "facility answer", nor even send a plain question directly.
SELECT set_config('request.jwt.claim.sub', 'fb8a0000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_qa(facility_id, user_id, question, answer, status, is_public, answered_at)
      VALUES ('fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000005',
              'Synthetic forged question', 'Synthetic forged answer', 'answered', true, now());
    RAISE EXCEPTION 'forged answered Q&A accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.facility_qa(facility_id, user_id, question, status, is_public)
      VALUES ('fb8a0001-0000-4000-8000-000000000001', 'fb8a0000-0000-4000-8000-000000000005',
              'Synthetic direct question', 'pending', true);
    RAISE EXCEPTION 'direct question INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.assert_scope((SELECT count(*) = 0 FROM public.facility_qa
    WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001'), 'a pending question is not public');
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_scope((SELECT count(*) = 0 FROM public.facility_qa
  WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001'), 'anon does not see a pending question');
RESET ROLE;

-- The owner reads the question but cannot answer, publish or delete it directly.
SELECT set_config('request.jwt.claim.sub', 'fb8a0000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM pg_temp.assert_scope((SELECT count(*) = 1 FROM public.facility_qa
    WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001'), 'owner reads the pending question');
  BEGIN
    UPDATE public.facility_qa SET answer = 'Synthetic direct answer', status = 'answered'
      WHERE id = 'fb8a0005-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct answer UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.facility_qa WHERE id = 'fb8a0005-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'direct Q&A DELETE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_scope((SELECT status = 'pending' AND answer IS NULL FROM public.facility_qa
  WHERE id = 'fb8a0005-0000-4000-8000-000000000001'), 'direct Q&A writes changed nothing');

-- ---------------------------------------------------------------------------
-- 監査ログ
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_scope(
  NOT has_any_column_privilege('anon', 'public.audit_logs', 'SELECT')
  AND NOT has_any_column_privilege('authenticated', 'public.audit_logs', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.audit_logs', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.audit_logs', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.audit_logs', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.audit_logs', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.audit_logs', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
  AND has_table_privilege('service_role', 'public.audit_logs', 'SELECT')
  AND has_table_privilege('service_role', 'public.audit_logs', 'INSERT'),
  'audit logs are service_role only');
SELECT pg_temp.assert_scope(NOT EXISTS(SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'audit_logs'), 'no audit log policy remains');
INSERT INTO public.audit_logs(user_id, facility_id, action, table_name, record_id, ip_address, user_agent) VALUES
  ('fb8a0000-0000-4000-8000-000000000004', 'fb8a0001-0000-4000-8000-000000000001', 'cancel', 'bookings',
   'fb8a0002-0000-4000-8000-000000000001', '192.0.2.44', 'Synthetic agent');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public.audit_logs WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'facility member read the audit log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_scope((SELECT count(*) = 1 FROM public.audit_logs
  WHERE facility_id = 'fb8a0001-0000-4000-8000-000000000001'), 'the server still reads and writes audit logs');
RESET ROLE;

ROLLBACK;
