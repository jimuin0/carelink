\set ON_ERROR_STOP on
-- Dedicated synthetic shadow DB only; every change rolls back and Google is never called.
-- 照合に使った店舗の登録内容が変わったら Place ID の登録が外れる（20261023150200）。
--   1. トリガがある
--   2. 店舗設定の保存（update_facility_settings_atomic）で電話番号を変えると、Place ID・CID・連携日時・評価・診断結果が外れる
--      （＝「電話番号を他店に合わせて保存 → 診断で評価を書き込む → 電話番号を戻す」で他店の評価が残らない）
--   3. 外れた Place ID は別の施設が登録できる（一意索引を占有し続けない）
--   4. 照合項目を変えない保存（同じ値・空白だけの違い・紹介文の変更）では外れない
--   5. 政令指定都市の区を市区町村と番地の間で移しても（掲載上の住所が同じなら）外れない
--   6. 店舗名・郵便番号・住所の変更でも外れる
-- 20261023150200 より前の定義では 2. の「電話番号を戻しても Place ID と評価が残る」で落ちる。
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ed720000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_gbp(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'gbp identity fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.place(f uuid) RETURNS text LANGUAGE sql AS $$ SELECT gbp_place_id FROM public.facility_profiles WHERE id=f $$;
-- 連携（保存）と診断（評価・診断結果の書き込み）を、アプリと同じ RPC で行う（準備なので fixture の実行ロールのまま呼ぶ）。
CREATE FUNCTION pg_temp.connect_and_refresh(actor uuid,f uuid,place text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.save_admin_facility_integration_atomic(actor,f,'gbp:connect','{}'::jsonb,jsonb_build_object('place_id',place,'cid','987'));
 PERFORM public.save_admin_facility_integration_atomic(actor,f,'gbp:refresh',jsonb_build_object('place_id',place),
  '{"rating":4.9,"review_count":2000,"score":80,"details":{"synthetic":true}}'::jsonb);
END $$;
CREATE FUNCTION pg_temp.attached(f uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT p.gbp_place_id IS NOT NULL AND p.google_rating=4.9 AND p.google_review_count=2000
  AND EXISTS(SELECT 1 FROM public.gbp_audit_cache c WHERE c.facility_id=f) FROM public.facility_profiles p WHERE p.id=f $$;
CREATE FUNCTION pg_temp.detached(f uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT p.gbp_place_id IS NULL AND p.gbp_cid IS NULL AND p.gbp_connected_at IS NULL AND p.google_rating IS NULL AND p.google_review_count=0
  AND NOT EXISTS(SELECT 1 FROM public.gbp_audit_cache c WHERE c.facility_id=f) FROM public.facility_profiles p WHERE p.id=f $$;

SELECT pg_temp.assert_gbp(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.facility_profiles'::regclass
 AND tgname='trg_release_gbp_on_identity_change' AND NOT tgisinternal),'trigger on facility_profiles');

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed720000-0000-4000-8000-000000000001','gbp-identity-a@example.invalid',now()),
 ('ed720000-0000-4000-8000-000000000002','gbp-identity-b@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,phone,postal_code,status) VALUES
 ('ed720001-0000-4000-8000-000000000001','Synthetic Identity A','synthetic-gbp-identity-a','その他','神奈川県','横浜市中区','山下町1-2','03-1234-5678','231-0023','draft'),
 ('ed720001-0000-4000-8000-000000000002','Synthetic Identity B','synthetic-gbp-identity-b','その他','検証県','検証市','検証住所B','06-0000-0000',NULL,'draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001','owner'),
 ('ed720000-0000-4000-8000-000000000002','ed720001-0000-4000-8000-000000000002','owner');

-- 4. 照合項目を変えない保存では外れない
SELECT pg_temp.connect_and_refresh('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001','ChIJSyntheticBorrowed');
SELECT pg_temp.assert_gbp(pg_temp.attached('ed720001-0000-4000-8000-000000000001'),'setup attached the Place ID with a rating and audit');
SET LOCAL ROLE service_role;
SELECT public.update_facility_settings_atomic('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001',
 '{"name":"Synthetic Identity A","phone":"03-1234-5678","postal_code":"231-0023","prefecture":"神奈川県","city":"横浜市中区","address":"山下町1-2","description":"紹介文だけ変える"}'::jsonb);
SELECT public.update_facility_settings_atomic('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001',
 '{"name":"Synthetic  Identity A ","phone":" 03-1234-5678"}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.attached('ed720001-0000-4000-8000-000000000001'),'unchanged identity keeps the Place ID, rating and audit');

-- 5. 区を市区町村から番地へ移す（掲載上の住所は同じ）では外れない
SET LOCAL ROLE service_role;
SELECT public.update_facility_settings_atomic('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001',
 '{"city":"横浜市","address":"中区山下町1-2"}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.attached('ed720001-0000-4000-8000-000000000001'),'moving the ward between city and address keeps the Place ID');

-- 2. 電話番号を変える（他店の番号から元へ戻す操作もこれと同じ）と、Place ID ごと外れる
SET LOCAL ROLE service_role;
SELECT public.update_facility_settings_atomic('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001',
 '{"phone":"045-000-0000"}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.detached('ed720001-0000-4000-8000-000000000001'),'changing the phone detaches the Place ID, rating and audit');

-- 3. 外れた Place ID は別の施設が登録できる
SET LOCAL ROLE service_role;
SELECT public.save_admin_facility_integration_atomic('ed720000-0000-4000-8000-000000000002','ed720001-0000-4000-8000-000000000002',
 'gbp:connect','{}'::jsonb,'{"place_id":"ChIJSyntheticBorrowed","cid":null}'::jsonb);
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.place('ed720001-0000-4000-8000-000000000002')='ChIJSyntheticBorrowed','the detached Place ID is free for its real owner');

-- 6. 店舗名・郵便番号・住所の変更でも外れる（service_role の直接 UPDATE でも同じ）
SELECT pg_temp.connect_and_refresh('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001','ChIJSyntheticA2');
SET LOCAL ROLE service_role;
UPDATE public.facility_profiles SET name='Borrowed Name' WHERE id='ed720001-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.detached('ed720001-0000-4000-8000-000000000001'),'changing the name detaches');
SELECT pg_temp.connect_and_refresh('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001','ChIJSyntheticA3');
SET LOCAL ROLE service_role;
UPDATE public.facility_profiles SET postal_code='100-0001' WHERE id='ed720001-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.detached('ed720001-0000-4000-8000-000000000001'),'changing the postal code detaches');
SELECT pg_temp.connect_and_refresh('ed720000-0000-4000-8000-000000000001','ed720001-0000-4000-8000-000000000001','ChIJSyntheticA4');
SET LOCAL ROLE service_role;
UPDATE public.facility_profiles SET address='中区山下町9-9' WHERE id='ed720001-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_gbp(pg_temp.detached('ed720001-0000-4000-8000-000000000001'),'changing the street address detaches');

SELECT 'gbp place detaches on identity change checks passed';
ROLLBACK;
