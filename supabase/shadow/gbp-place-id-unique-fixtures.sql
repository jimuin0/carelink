\set ON_ERROR_STOP on
-- Dedicated synthetic shadow DB only; every change rolls back and Google is never called.
-- 同じ Google の店舗（Place ID）を 2 つの施設に付けられない（20261023150000）。
--   1. 部分ユニーク索引があり、空文字・空白だけの値（未設定と同じ）は対象外
--   2. 保存 RPC（gbp:connect）で別の施設と同じ ID を保存すると 23505（アプリは「別の店舗に登録されています」409）
--   3. 自施設への同じ ID の再保存・CID だけの変更・ID を消す保存は通る
--   4. 消した後なら、別の施設が同じ ID を保存できる
--   5. service_role の直接 UPDATE でも重複は作れない
-- 20261023150000 より前の定義では 2. の「2 つ目の施設が同じ ID を保存できた」で落ちる。
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ed710000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_gbp(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'gbp place fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.place(f uuid) RETURNS text LANGUAGE sql AS $$ SELECT gbp_place_id FROM public.facility_profiles WHERE id=f $$;

SELECT pg_temp.assert_gbp((SELECT i.indisunique AND i.indpred IS NOT NULL FROM pg_index i
 WHERE i.indexrelid=to_regclass('public.uq_facility_profiles_gbp_place_id')),'partial unique index on gbp_place_id');

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed710000-0000-4000-8000-000000000001','gbp-owner-a@example.invalid',now()),
 ('ed710000-0000-4000-8000-000000000002','gbp-owner-b@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ed710001-0000-4000-8000-000000000001','Synthetic GBP A','synthetic-gbp-unique-a','その他','検証県','検証市','検証住所A','draft'),
 ('ed710001-0000-4000-8000-000000000002','Synthetic GBP B','synthetic-gbp-unique-b','その他','検証県','検証市','検証住所B','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed710000-0000-4000-8000-000000000001','ed710001-0000-4000-8000-000000000001','owner'),
 ('ed710000-0000-4000-8000-000000000002','ed710001-0000-4000-8000-000000000002','owner');

-- 2. A が保存した ID を B が保存しようとすると 23505。B には何も保存されない。
SET LOCAL ROLE service_role;
SELECT public.save_admin_facility_integration_atomic('ed710000-0000-4000-8000-000000000001','ed710001-0000-4000-8000-000000000001',
 'gbp:connect','{}'::jsonb,'{"place_id":"ChIJSyntheticShared","cid":null}'::jsonb);
DO $$ BEGIN
 BEGIN
  PERFORM public.save_admin_facility_integration_atomic('ed710000-0000-4000-8000-000000000002','ed710001-0000-4000-8000-000000000002',
   'gbp:connect','{}'::jsonb,'{"place_id":"ChIJSyntheticShared","cid":null}'::jsonb);
  RAISE EXCEPTION 'second facility attached the same Place ID';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.place('ed710001-0000-4000-8000-000000000001')='ChIJSyntheticShared'
 AND pg_temp.place('ed710001-0000-4000-8000-000000000002') IS NULL,'refused save leaves the second facility unchanged');

-- 3. 自施設への再保存（CID だけ変える）と、消す保存は通る
SET LOCAL ROLE service_role;
SELECT public.save_admin_facility_integration_atomic('ed710000-0000-4000-8000-000000000001','ed710001-0000-4000-8000-000000000001',
 'gbp:connect','{}'::jsonb,'{"place_id":"ChIJSyntheticShared","cid":"123"}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp((SELECT gbp_cid='123' FROM public.facility_profiles WHERE id='ed710001-0000-4000-8000-000000000001'),'same facility may save its own Place ID again');
SET LOCAL ROLE service_role;
SELECT public.save_admin_facility_integration_atomic('ed710000-0000-4000-8000-000000000001','ed710001-0000-4000-8000-000000000001',
 'gbp:connect','{}'::jsonb,'{"place_id":null,"cid":null}'::jsonb);
-- 4. 外した後なら別の施設が保存できる
SELECT public.save_admin_facility_integration_atomic('ed710000-0000-4000-8000-000000000002','ed710001-0000-4000-8000-000000000002',
 'gbp:connect','{}'::jsonb,'{"place_id":"ChIJSyntheticShared","cid":null}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.place('ed710001-0000-4000-8000-000000000001') IS NULL
 AND pg_temp.place('ed710001-0000-4000-8000-000000000002')='ChIJSyntheticShared','released Place ID can move to another facility');

-- 5. 直接の UPDATE でも重複は作れない。空文字・空白だけ（未設定と同じ）は何件あってもよい。
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  UPDATE public.facility_profiles SET gbp_place_id='ChIJSyntheticShared' WHERE id='ed710001-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'direct update duplicated a Place ID';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.facility_profiles SET gbp_place_id='' WHERE id='ed710001-0000-4000-8000-000000000001';
UPDATE public.facility_profiles SET gbp_place_id=' ' WHERE id='ed710001-0000-4000-8000-000000000002';
SELECT pg_temp.assert_gbp((SELECT count(*)=2 FROM public.facility_profiles WHERE id::text LIKE 'ed710001-%' AND btrim(gbp_place_id)=''),'blank values are not unique-constrained');

SELECT 'gbp place id uniqueness, release and blank checks passed';
ROLLBACK;
