\set ON_ERROR_STOP on
-- Dedicated synthetic shadow DB only; every change rolls back and Google is never called.
-- GBP の連携保存は、照合に使った店舗の登録内容（p_expected.identity）と今の行が一致するときだけ通る（20261023150300）。
--   1. 照合した内容と同じなら保存できる
--   2. 照会の間に店名・電話・住所が変わっていたら 40001（INTEGRATION_CHANGED）で断り、何も書かない
--   3. identity 以外のキーが混ざった expected は 22023
--   4. 解除（place_id null）と、旧アプリの '{}' は従来どおり通る
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ed730000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_bind(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'gbp connect identity fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.try_connect(expected jsonb,place text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.save_admin_facility_integration_atomic('ed730000-0000-4000-8000-000000000001','ed730001-0000-4000-8000-000000000001',
  'gbp:connect',expected,jsonb_build_object('place_id',place,'cid',NULL));
 RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
CREATE FUNCTION pg_temp.place() RETURNS text LANGUAGE sql AS $$
 SELECT gbp_place_id FROM public.facility_profiles WHERE id='ed730001-0000-4000-8000-000000000001' $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed730000-0000-4000-8000-000000000001','gbp-bind-owner@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,phone,postal_code,status) VALUES
 ('ed730001-0000-4000-8000-000000000001','Synthetic Bind','synthetic-gbp-bind','その他','検証県','検証市','検証町1-1','03-1111-2222','100-0001','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed730000-0000-4000-8000-000000000001','ed730001-0000-4000-8000-000000000001','owner');

SET LOCAL ROLE service_role;
-- 2. 照合時の内容（他店に合わせた電話番号）と今の行が違えば断る
SELECT pg_temp.assert_bind(pg_temp.try_connect(jsonb_build_object('identity',jsonb_build_object(
  'name','Synthetic Bind','phone','06-9999-0000','postal_code','100-0001','prefecture','検証県','city','検証市','address','検証町1-1')),
  'ChIJStaleCheck')='40001','stale identity refused');
SELECT pg_temp.assert_bind(pg_temp.place() IS NULL,'refused connect wrote nothing');
-- 3. identity 以外のキーは受け付けない
SELECT pg_temp.assert_bind(pg_temp.try_connect('{"identity":{},"place_id":"x"}'::jsonb,'ChIJExtra')='22023','extra expected keys refused');
-- 1. 照合した内容と同じなら保存できる
SELECT pg_temp.assert_bind(pg_temp.try_connect(jsonb_build_object('identity',jsonb_build_object(
  'name','Synthetic Bind','phone','03-1111-2222','postal_code','100-0001','prefecture','検証県','city','検証市','address','検証町1-1')),
  'ChIJVerified')='ok','matching identity saves');
SELECT pg_temp.assert_bind(pg_temp.place()='ChIJVerified','place attached');
-- 4. 解除と旧アプリの '{}'
SELECT pg_temp.assert_bind(pg_temp.try_connect('{}'::jsonb,NULL)='ok','clear with {} still works');
SELECT pg_temp.assert_bind(pg_temp.place() IS NULL,'place cleared');
SELECT pg_temp.assert_bind(pg_temp.try_connect('{}'::jsonb,'ChIJLegacyApp')='ok','legacy {} connect still accepted');
-- 実行権限は service_role のみ
RESET ROLE;
SELECT pg_temp.assert_bind(NOT has_function_privilege('authenticated','public.save_admin_facility_integration_atomic(uuid,uuid,text,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.save_admin_facility_integration_atomic(uuid,uuid,text,jsonb,jsonb)','EXECUTE'),'service role only');
ROLLBACK;
