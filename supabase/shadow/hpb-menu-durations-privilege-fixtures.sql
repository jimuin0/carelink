-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- HPB menu import rows (20261023030000 adds missing_since / applied_at, 20261023030100
-- closes browser writes; this asserts the state after both). The bulk reflect relies on
-- kind, store_id, missing_since and applied_at, so no browser role may write any row.
-- Only owner/admin members read their own facility's rows; staff and other facilities
-- read nothing. Every write goes through service_role (API routes and the nightly cron).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fb7b0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fb7b0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- The bootstrap stub returns NULL. Emulate the real JWT identity so a direct
-- write is attempted as the member itself; ROLLBACK restores the stub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION pg_temp.assert_hpb(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'hpb menu fixture: %', label; END IF; END $$;

-- Privilege surface: browser roles read only (anon nothing); service_role keeps writes.
SELECT pg_temp.assert_hpb(
  NOT has_table_privilege('anon', 'public.hpb_menu_durations', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.hpb_menu_durations', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.hpb_menu_durations', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.hpb_menu_durations', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.hpb_menu_durations', 'TRUNCATE')
  AND has_table_privilege('authenticated', 'public.hpb_menu_durations', 'SELECT')
  AND NOT has_any_column_privilege('authenticated', 'public.hpb_menu_durations', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.hpb_menu_durations', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.hpb_menu_durations', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.hpb_menu_durations', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.hpb_menu_durations', 'INSERT')
  AND has_table_privilege('service_role', 'public.hpb_menu_durations', 'UPDATE')
  AND has_table_privilege('service_role', 'public.hpb_menu_durations', 'DELETE'),
  'browser roles cannot write; service_role can');
SELECT pg_temp.assert_hpb(
  (SELECT array_agg(policyname::text || ':' || cmd ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'hpb_menu_durations') = ARRAY['hpb_menu_durations_member_read:SELECT'],
  'only the owner/admin read policy remains');

-- Owner (01), staff (02) of A; owner of B only (03).
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fb7b0000-0000-4000-8000-000000000001', 'hpb-owner@example.invalid', now()),
  ('fb7b0000-0000-4000-8000-000000000002', 'hpb-staff@example.invalid', now()),
  ('fb7b0000-0000-4000-8000-000000000003', 'hpb-other@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fb7b0001-0000-4000-8000-000000000001', 'Synthetic HPB A', 'synthetic-hpb-a', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fb7b0001-0000-4000-8000-000000000002', 'Synthetic HPB B', 'synthetic-hpb-b', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fb7b0000-0000-4000-8000-000000000001', 'fb7b0001-0000-4000-8000-000000000001', 'owner'),
  ('fb7b0000-0000-4000-8000-000000000002', 'fb7b0001-0000-4000-8000-000000000001', 'staff'),
  ('fb7b0000-0000-4000-8000-000000000003', 'fb7b0001-0000-4000-8000-000000000002', 'owner');

-- The service role saves fetched rows (as /api/admin/hpb-menus and the cron do).
SET LOCAL ROLE service_role;
INSERT INTO public.hpb_menu_durations(facility_id, ref_id, kind, store_id, name, price, duration_min) VALUES
  ('fb7b0001-0000-4000-8000-000000000001', 'CPSYN1', 'coupon', 'HSYN1', 'Synthetic new-only coupon', 3980, 60),
  ('fb7b0001-0000-4000-8000-000000000002', 'MNSYN2', 'menu', 'HSYN2', 'Synthetic menu B', 6000, 60);
UPDATE public.hpb_menu_durations SET missing_since = now(), applied_at = now()
  WHERE facility_id = 'fb7b0001-0000-4000-8000-000000000002';
RESET ROLE;
SELECT pg_temp.assert_hpb(
  (SELECT missing_since IS NULL AND applied_at IS NULL FROM public.hpb_menu_durations WHERE ref_id = 'CPSYN1')
  AND (SELECT missing_since IS NOT NULL AND applied_at IS NOT NULL FROM public.hpb_menu_durations WHERE ref_id = 'MNSYN2'),
  'new columns default to NULL and the service role sets them');

-- Direct browser writes fail for the owner, a staff member and a member of another facility.
DO $$ DECLARE actor uuid; BEGIN
  FOREACH actor IN ARRAY ARRAY['fb7b0000-0000-4000-8000-000000000001', 'fb7b0000-0000-4000-8000-000000000002',
    'fb7b0000-0000-4000-8000-000000000003']::uuid[] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_hpb(auth.uid() = actor, 'synthetic JWT identity applied');
    BEGIN
      INSERT INTO public.hpb_menu_durations(facility_id, ref_id, kind, store_id, name, price, duration_min)
        VALUES ('fb7b0001-0000-4000-8000-000000000001', 'MNFAKE', 'menu', 'HSYN1', 'Synthetic fake menu', 1, 60);
      RAISE EXCEPTION 'direct INSERT accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.hpb_menu_durations SET kind = 'menu', applied_at = NULL, missing_since = NULL
        WHERE ref_id = 'CPSYN1';
      RAISE EXCEPTION 'direct UPDATE accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      DELETE FROM public.hpb_menu_durations WHERE ref_id = 'CPSYN1';
      RAISE EXCEPTION 'direct DELETE accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
END $$;
SELECT pg_temp.assert_hpb(
  (SELECT count(*) = 2 FROM public.hpb_menu_durations WHERE ref_id IN ('CPSYN1', 'MNSYN2', 'MNFAKE'))
  AND (SELECT kind = 'coupon' AND applied_at IS NULL FROM public.hpb_menu_durations WHERE ref_id = 'CPSYN1'),
  'direct writes changed nothing');

-- Reads: the owner sees only their facility's rows; staff sees nothing.
DO $$ DECLARE seen text[]; BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'fb7b0000-0000-4000-8000-000000000001', true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(ref_id ORDER BY ref_id) INTO seen FROM public.hpb_menu_durations WHERE ref_id LIKE '%SYN%';
  PERFORM pg_temp.assert_hpb(seen = ARRAY['CPSYN1'], 'owner reads only their facility');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', 'fb7b0000-0000-4000-8000-000000000002', true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.assert_hpb(NOT EXISTS(SELECT 1 FROM public.hpb_menu_durations WHERE ref_id LIKE '%SYN%'),
    'staff reads nothing');
  RESET ROLE;
END $$;
ROLLBACK;
