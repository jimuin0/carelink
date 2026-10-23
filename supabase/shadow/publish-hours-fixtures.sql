-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- Asserts the state after 20261023170000 (free listing requires confirmed business hours):
--   * 下書き・休止から公開する操作は、曜日別の営業時間（public.confirmed_booking_hours）が無いと
--     check_violation '"published_facility_hours_confirmed"' で断られ、何も書き込まれない
--     （設定画面の公開 update_facility_settings_atomic・チェーン一括公開 set_facilities_publication_atomic の両方）。
--   * 7曜日そろった営業時間を保存すれば公開できる。メニュー・写真・スタッフは要らない（掲載はネット予約と別）。
--   * 既に公開中の行は、営業時間に関係しない保存（施設名・公開の再送）では再検査されない
--     （営業時間の無い旧データの公開行も、止められたり非公開にされたりしない）。
--   * 公開中の行の営業時間を、確認済みでない形へ変える保存は断られる。確認済みの形への変更は通る。
--   * 所有者・所在地の検査は従来どおり先に効く（エラーの種類が変わらない）。
--   * 非公開化は営業時間を見ない。RPC は service_role だけが実行できる。
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa8b0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fa8b0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_hours(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'publish hours fixture: %', label; END IF; END $$;
-- Runs a statement and returns 'ok' or SQLSTATE:SQLERRM.
CREATE FUNCTION pg_temp.try_sql(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.status_of(f uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.facility_profiles WHERE id = f $$;

SELECT pg_temp.assert_hours(
  has_function_privilege('service_role', 'public.update_facility_settings_atomic(uuid,uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.set_facilities_publication_atomic(uuid,uuid[],boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_facility_settings_atomic(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.update_facility_settings_atomic(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.set_facilities_publication_atomic(uuid,uuid[],boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.set_facilities_publication_atomic(uuid,uuid[],boolean)', 'EXECUTE'),
  'publish RPCs remain server-only');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fa8b0000-0000-4000-8000-000000000001', 'publish-hours-owner@example.invalid', now()),
  ('fa8b0000-0000-4000-8000-000000000002', 'publish-hours-admin@example.invalid', now()),
  ('fa8b0000-0000-4000-8000-000000000003', 'publish-hours-owner-b@example.invalid', now()),
  ('fa8b0000-0000-4000-8000-000000000004', 'publish-hours-owner-legacy@example.invalid', now()),
  ('fa8b0000-0000-4000-8000-000000000005', 'publish-hours-owner-no-address@example.invalid', now());
-- 01: draft, located, no hours.            02: draft, located, no hours (bulk publish).
-- 03: legacy published row without hours.  04: draft without an address but with hours.
-- 05: draft with hours but no owner (admin only).
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status, business_hours) VALUES
  ('fa8b0001-0000-4000-8000-000000000001', 'Synthetic hours A', 'synthetic-publish-hours-a', 'その他', '検証県', '検証市', '検証町1-1', 'draft', NULL),
  ('fa8b0001-0000-4000-8000-000000000002', 'Synthetic hours B', 'synthetic-publish-hours-b', 'その他', '検証県', '検証市', '検証町1-2', 'draft', NULL),
  ('fa8b0001-0000-4000-8000-000000000003', 'Synthetic hours legacy', 'synthetic-publish-hours-legacy', 'その他', '検証県', '検証市', '検証町1-3', 'published', NULL),
  ('fa8b0001-0000-4000-8000-000000000004', 'Synthetic hours no address', 'synthetic-publish-hours-no-address', 'その他', '検証県', '検証市', '', 'draft',
    '{"mon":{"open":"10:00","close":"19:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'),
  ('fa8b0001-0000-4000-8000-000000000005', 'Synthetic hours ownerless', 'synthetic-publish-hours-ownerless', 'その他', '検証県', '検証市', '検証町1-5', 'draft',
    '{"mon":{"open":"10:00","close":"19:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}');
-- One owner per account (uq_facility_members_one_owner_per_user): each facility gets its own
-- owner, and the acting account 01 manages B, legacy and no-address as admin (the publish RPCs
-- accept owner or admin as the actor and require that the facility has an owner).
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000001', 'owner'),
  ('fa8b0000-0000-4000-8000-000000000003', 'fa8b0001-0000-4000-8000-000000000002', 'owner'),
  ('fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000002', 'admin'),
  ('fa8b0000-0000-4000-8000-000000000004', 'fa8b0001-0000-4000-8000-000000000003', 'owner'),
  ('fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000003', 'admin'),
  ('fa8b0000-0000-4000-8000-000000000005', 'fa8b0001-0000-4000-8000-000000000004', 'owner'),
  ('fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000004', 'admin'),
  ('fa8b0000-0000-4000-8000-000000000002', 'fa8b0001-0000-4000-8000-000000000005', 'admin');

SET LOCAL ROLE service_role;

-- 1. 設定画面の公開：営業時間が無い／欠けている／全曜日休み／前後逆なら断る（何も書かない）
DO $$
DECLARE
  owner_id text := 'fa8b0000-0000-4000-8000-000000000001';
  a text := 'fa8b0001-0000-4000-8000-000000000001';
  hours text;
  result text;
BEGIN
  result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)', owner_id, a, '{"status":"published"}'));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_hours_confirmed"', 'publish without hours refused: ' || result);
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'draft', 'refused publish wrote nothing');
  FOREACH hours IN ARRAY ARRAY[
    '{"mon":{"open":"10:00","close":"19:00"}}',
    '{"mon":null,"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}',
    '{"mon":{"open":"19:00","close":"10:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
  ] LOOP
    -- 営業時間と公開を同じ保存で送っても、確認済みでない営業時間では公開できない
    result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)', owner_id, a,
      jsonb_build_object('status', 'published', 'business_hours', hours::jsonb)::text));
    PERFORM pg_temp.assert_hours(result = '23514:"published_facility_hours_confirmed"', 'unconfirmed hours refused: ' || hours || ' -> ' || result);
  END LOOP;
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'draft'
    AND (SELECT business_hours IS NULL FROM public.facility_profiles WHERE id = a::uuid), 'refused saves left the row unchanged');

  -- 下書きのまま確認済みでない営業時間を保存するのは従来どおり自由（公開していないので検査しない）
  result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)', owner_id, a,
    '{"business_hours":{"mon":{"open":"10:00","close":"19:00"}}}'));
  PERFORM pg_temp.assert_hours(result = 'ok', 'draft may save partial hours: ' || result);

  -- 7曜日そろえれば公開できる（メニュー・写真・スタッフは要らない）
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, a::uuid,
    '{"business_hours":{"mon":{"open":"10:00","close":"19:00"},"tue":null,"wed":{"open":"10:00","close":"19:00"},"thu":{"open":"10:00","close":"19:00"},"fri":{"open":"10:00","close":"19:00"},"sat":{"open":"10:00","close":"17:00"},"sun":null}}'::jsonb);
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, a::uuid, '{"status":"published"}'::jsonb);
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'published', 'confirmed hours publish');
  PERFORM pg_temp.assert_hours(NOT EXISTS(SELECT 1 FROM public.facility_menus WHERE facility_id = a::uuid)
    AND NOT EXISTS(SELECT 1 FROM public.facility_photos WHERE facility_id = a::uuid)
    AND NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE facility_id = a::uuid), 'listing needs no booking catalog');

  -- 公開中の行：営業時間を確認済みでない形へ変える保存は断る。確認済みの形への変更・無関係な保存は通る
  result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)', owner_id, a,
    '{"business_hours":{"mon":{"open":"10:00","close":"19:00"}}}'));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_hours_confirmed"', 'published row cannot drop its hours: ' || result);
  result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)', owner_id, a,
    '{"business_hours":null}'));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_hours_confirmed"', 'published row cannot clear its hours: ' || result);
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, a::uuid,
    '{"business_hours":{"mon":{"open":"09:00","close":"18:00"},"tue":{"open":"09:00","close":"18:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}}'::jsonb);
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, a::uuid, '{"name":"Synthetic hours A renamed"}'::jsonb);
  PERFORM pg_temp.assert_hours((SELECT status = 'published' AND name = 'Synthetic hours A renamed'
    AND business_hours -> 'mon' ->> 'open' = '09:00' FROM public.facility_profiles WHERE id = a::uuid), 'confirmed change and unrelated save pass');

  -- 非公開化は営業時間を見ない
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, a::uuid, '{"status":"draft"}'::jsonb);
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'draft', 'unpublish needs no hours check');
END $$;

-- 2. 営業時間の無い旧データの公開行は、無関係な保存で止められず、非公開にもされない
DO $$
DECLARE
  owner_id text := 'fa8b0000-0000-4000-8000-000000000001';
  legacy text := 'fa8b0001-0000-4000-8000-000000000003';
BEGIN
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, legacy::uuid, '{"name":"Synthetic hours legacy renamed","phone":"03-0000-0000"}'::jsonb);
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, legacy::uuid, '{"status":"published"}'::jsonb);
  PERFORM public.set_facilities_publication_atomic(owner_id::uuid, ARRAY[legacy::uuid], true);
  PERFORM pg_temp.assert_hours((SELECT status = 'published' AND name = 'Synthetic hours legacy renamed' AND business_hours IS NULL
    FROM public.facility_profiles WHERE id = legacy::uuid), 'legacy published row is not re-validated by unrelated writes');
END $$;

-- 3. チェーン一括公開：営業時間の無い施設が1つでもあれば全体を断る（部分公開しない）
DO $$
DECLARE
  owner_id text := 'fa8b0000-0000-4000-8000-000000000001';
  a text := 'fa8b0001-0000-4000-8000-000000000001';
  b text := 'fa8b0001-0000-4000-8000-000000000002';
  result text;
BEGIN
  result := pg_temp.try_sql(format('SELECT public.set_facilities_publication_atomic(%L,ARRAY[%L,%L]::uuid[],true)', owner_id, a, b));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_hours_confirmed"', 'bulk publish without hours refused: ' || result);
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'draft' AND pg_temp.status_of(b::uuid) = 'draft', 'refused bulk publish wrote nothing');
  -- 非公開化（一括）は営業時間を見ない
  PERFORM public.set_facilities_publication_atomic(owner_id::uuid, ARRAY[a::uuid, b::uuid], false);
  PERFORM public.update_facility_settings_atomic(owner_id::uuid, b::uuid, jsonb_build_object('business_hours',
    (SELECT jsonb_object_agg(d, jsonb_build_object('open', '10:00', 'close', '19:00')) FROM unnest(ARRAY['mon','tue','wed','thu','fri','sat','sun']) d)));
  PERFORM public.set_facilities_publication_atomic(owner_id::uuid, ARRAY[a::uuid, b::uuid], true);
  PERFORM pg_temp.assert_hours(pg_temp.status_of(a::uuid) = 'published' AND pg_temp.status_of(b::uuid) = 'published', 'bulk publish with hours');
END $$;

-- 4. 所有者・所在地の検査は先に効く（営業時間より前・エラーの種類は従来どおり）
DO $$
DECLARE
  result text;
BEGIN
  result := pg_temp.try_sql(format('SELECT public.update_facility_settings_atomic(%L,%L,%L::jsonb)',
    'fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000004', '{"status":"published","business_hours":null}'));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_location_present"', 'location is still checked first: ' || result);
  result := pg_temp.try_sql(format('SELECT public.set_facilities_publication_atomic(%L,ARRAY[%L]::uuid[],true)',
    'fa8b0000-0000-4000-8000-000000000001', 'fa8b0001-0000-4000-8000-000000000004'));
  PERFORM pg_temp.assert_hours(result = '23514:"published_facility_location_present"', 'bulk location is still checked first: ' || result);
  result := pg_temp.try_sql(format('SELECT public.set_facilities_publication_atomic(%L,ARRAY[%L]::uuid[],true)',
    'fa8b0000-0000-4000-8000-000000000002', 'fa8b0001-0000-4000-8000-000000000005'));
  PERFORM pg_temp.assert_hours(result LIKE 'P0001:FACILITY_OWNER_REQUIRED%', 'owner is still checked first: ' || result);
END $$;

RESET ROLE;
ROLLBACK;
