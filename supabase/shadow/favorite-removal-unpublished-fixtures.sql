-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- Asserts the state after 20261023140000:
--   * お気に入りから外す操作（p_desired=false / トグル）は、施設が下書き・停止になっていても成功し、行が消える。
--   * 追加（p_desired=true / 行が無いときのトグル）は、これまでどおり公開中の施設にしかできない（P0002）。
--   * 公開中の施設では、追加・削除・トグルの結果がこれまでと同じ。
--   * RPC は service_role だけが実行でき、ブラウザのロールは favorites へ書けない。
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa7f0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fa7f0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_fav(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'favorite removal fixture: %', label; END IF; END $$;
-- Returns the RPC result as text, or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.fav_try(p_actor uuid, p_facility uuid, p_desired boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN
  r := public.toggle_user_favorite_atomic(p_actor, p_facility, p_desired);
  RETURN r::text;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.fav_rows(p_actor uuid, p_facility uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.favorites WHERE user_id = p_actor AND facility_id = p_facility $$;

-- Privileges are unchanged: only the server gateway runs the RPC; browser roles cannot write rows.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(role_name, 'public.toggle_user_favorite_atomic(uuid,uuid,boolean)', 'EXECUTE') THEN
      RAISE EXCEPTION 'favorite RPC exposed to %', role_name;
    END IF;
    IF has_table_privilege(role_name, 'public.favorites', 'INSERT')
      OR has_table_privilege(role_name, 'public.favorites', 'DELETE')
      OR has_table_privilege(role_name, 'public.favorites', 'UPDATE') THEN
      RAISE EXCEPTION 'favorites writable by %', role_name;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.toggle_user_favorite_atomic(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service gateway lost';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid = 'public.toggle_user_favorite_atomic(uuid,uuid,boolean)'::regprocedure
      AND NOT prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'favorite RPC must stay SECURITY INVOKER with an empty search_path';
  END IF;
END $$;

-- 01 customer. Facility 01 published, 02 draft-to-be, 03 suspended-to-be.
INSERT INTO auth.users(id, email) VALUES
  ('fa7f0000-0000-4000-8000-000000000001', 'favorite-removal@example.invalid');
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fa7f0001-0000-4000-8000-000000000001', 'Synthetic favorite published', 'synthetic-favorite-published', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fa7f0001-0000-4000-8000-000000000002', 'Synthetic favorite draft', 'synthetic-favorite-draft', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fa7f0001-0000-4000-8000-000000000003', 'Synthetic favorite suspended', 'synthetic-favorite-suspended', 'その他', '検証県', '検証市', '検証住所', 'draft');
\ir listing-verification-setup.sql
SELECT pg_temp.approve_synthetic_listing('fa7f0001-0000-4000-8000-000000000001');
SELECT pg_temp.approve_synthetic_listing('fa7f0001-0000-4000-8000-000000000002');
SELECT pg_temp.approve_synthetic_listing('fa7f0001-0000-4000-8000-000000000003');
UPDATE public.facility_profiles SET status='published' WHERE id IN ('fa7f0001-0000-4000-8000-000000000001','fa7f0001-0000-4000-8000-000000000002','fa7f0001-0000-4000-8000-000000000003');


SET LOCAL ROLE service_role;
-- The customer favorites all three while they are published.
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', f.id, true) = 'true',
  'adding a published facility succeeds: ' || f.id::text)
FROM (VALUES ('fa7f0001-0000-4000-8000-000000000001'::uuid), ('fa7f0001-0000-4000-8000-000000000002'::uuid),
  ('fa7f0001-0000-4000-8000-000000000003'::uuid)) AS f(id);
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', f.id) = 1, 'favorite row exists: ' || f.id::text)
FROM (VALUES ('fa7f0001-0000-4000-8000-000000000001'::uuid), ('fa7f0001-0000-4000-8000-000000000002'::uuid),
  ('fa7f0001-0000-4000-8000-000000000003'::uuid)) AS f(id);
RESET ROLE;

-- The shop returns to draft, and another is suspended (e.g. the last owner left).
UPDATE public.facility_profiles SET status = 'draft' WHERE id = 'fa7f0001-0000-4000-8000-000000000002';
UPDATE public.facility_profiles SET status = 'suspended' WHERE id = 'fa7f0001-0000-4000-8000-000000000003';

SET LOCAL ROLE service_role;
-- 1) Explicit removal of a draft facility's favorite succeeds and the row is gone (the old body raised P0002).
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002', false) = 'false',
  'removing a draft facility returns false');
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002') = 0,
  'the draft facility favorite row is deleted');
-- Removing again is idempotent.
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002', false) = 'false',
  'repeated removal is idempotent');
-- 2) Adding it back while it is a draft is still refused, and no row appears.
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002', true) = 'P0002',
  'adding a draft facility is refused');
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002', NULL) = 'P0002',
  'a toggle without an existing row cannot add a draft facility');
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000002') = 0,
  'no row was added for the draft facility');
-- 3) A toggle on an existing favorite of a suspended facility removes it.
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000003', NULL) = 'false',
  'toggling a suspended facility favorite removes it');
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000003') = 0,
  'the suspended facility favorite row is deleted');
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000003', NULL) = 'P0002',
  'the next toggle cannot add the suspended facility back');
-- 4) A published facility behaves as before: toggle removes, toggle adds, explicit states are idempotent.
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001', NULL) = 'false',
  'toggle removes an existing published favorite');
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001', NULL) = 'true',
  'toggle adds a published favorite');
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001', true) = 'true',
  'adding twice is idempotent');
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001') = 1,
  'exactly one published favorite row');
-- 5) Scope errors are unchanged.
SELECT pg_temp.assert_fav(pg_temp.fav_try(NULL, 'fa7f0001-0000-4000-8000-000000000002', false) = '22023',
  'a missing actor is refused');
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', NULL, false) = '22023',
  'a missing facility id is refused');
RESET ROLE;

-- 6) A browser session still cannot run the RPC, even to remove a row.
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_fav(pg_temp.fav_try('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001', false) = '42501',
  'authenticated cannot call the RPC');
RESET ROLE;
SELECT pg_temp.assert_fav(pg_temp.fav_rows('fa7f0000-0000-4000-8000-000000000001', 'fa7f0001-0000-4000-8000-000000000001') = 1,
  'the browser attempt removed nothing');

ROLLBACK;
