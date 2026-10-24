-- All records below are synthetic and the transaction is rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' THEN RAISE EXCEPTION 'disposable carelink_shadow required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_setup(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'facility setup fixture: %',label; END IF;
END $$;
INSERT INTO auth.users(id,email)
SELECT ('68000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'synthetic-setup-'||n::text||'@example.invalid' FROM generate_series(1,6) n;
INSERT INTO public.salons(id,facility_name,business_type,representative_name,contact_name,email,phone,prefecture,city,address,seat_count,staff_count,has_parking,features,photo_urls,source)
SELECT ('69000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'Synthetic branch '||n::text,'ヘアサロン','Synthetic representative','Synthetic contact','same-operator@example.invalid','09000000000','愛知県','合成市','合成町'||n::text,
  0,0,false,ARRAY['synthetic'],ARRAY['https://assets.example.invalid/synthetic-'||n::text||'.png'],'register'
FROM generate_series(1,5) n;
SELECT pg_temp.assert_setup(
  has_function_privilege('service_role','public.setup_facility_from_registration(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','public.setup_facility_from_registration(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.setup_facility_from_registration(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)','EXECUTE'),
  'service-only execute ACL');
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.setup_facility_from_registration('68000000-0000-4000-8000-000000000001','none',NULL,NULL,NULL,NULL,'{}',true);
    RAISE EXCEPTION 'anon setup bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.setup_facility_from_registration('68000000-0000-4000-8000-000000000001','none',NULL,NULL,NULL,NULL,'{}',true);
    RAISE EXCEPTION 'authenticated setup bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_setup((SELECT outcome='invalid' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000001','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',false)), 'license required');
SELECT pg_temp.assert_setup((SELECT outcome='unverified' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000001','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp()-interval '72 hours','{}',true)), 'expired legacy never falls back');
SELECT pg_temp.assert_setup((SELECT outcome='invalid' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000001','none',NULL,NULL,NULL,NULL,'{"role":"owner"}',true)), 'unknown profile fields rejected');
SELECT pg_temp.assert_setup((SELECT outcome='created' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000001','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',true)), 'one selected legacy receipt creates');
SELECT pg_temp.assert_setup((SELECT count(*)=1 FROM public.salons WHERE claimed_facility_id IS NOT NULL), 'same email branches are not merged');
SELECT pg_temp.assert_setup((SELECT p.name='Synthetic branch 1' AND p.address='合成町1' AND p.seat_count=0 AND p.staff_count=0 AND p.parking=false AND p.status='draft'
  FROM public.facility_profiles p JOIN public.salons s ON s.claimed_facility_id=p.id WHERE s.id='69000000-0000-4000-8000-000000000001'), 'exact receipt and zero/false values retained');
SELECT pg_temp.assert_setup((SELECT count(*)=1 AND bool_and(photo_type='other') FROM public.facility_photos
  WHERE facility_id=(SELECT claimed_facility_id FROM public.salons WHERE id='69000000-0000-4000-8000-000000000001')), 'legacy optional first photo not misclassified exterior');
SELECT pg_temp.assert_setup((SELECT outcome='replay' AND facility_id=(SELECT claimed_facility_id FROM public.salons WHERE id='69000000-0000-4000-8000-000000000001')
  FROM public.setup_facility_from_registration('68000000-0000-4000-8000-000000000001','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',true)), 'response loss reuses exact facility');
SELECT pg_temp.assert_setup((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome'), 'no replay welcome duplicate');
DO $$ DECLARE bad jsonb; rejected boolean; target text;
BEGIN
  SELECT claimed_facility_id::text INTO target FROM public.salons WHERE id='69000000-0000-4000-8000-000000000001';
  FOREACH bad IN ARRAY ARRAY[
    NULL::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,
    '{"user_id":null,"template_version":1}'::jsonb,
    '{"user_id":"not-a-uuid","template_version":1}'::jsonb,
    '{"user_id":"68000000-0000-4000-8000-000000000001","template_version":"1"}'::jsonb,
    '{"user_id":"68000000-0000-4000-8000-000000000001","template_version":2}'::jsonb,
    '{"user_id":"68000000-0000-4000-8000-000000000001","template_version":1,"email":"synthetic@example.invalid"}'::jsonb
  ] LOOP
    rejected := false;
    BEGIN
      INSERT INTO public.webhook_retry_queue(webhook_type,target_id,payload)
        VALUES('facility_welcome',gen_random_uuid()::text,bad);
    EXCEPTION WHEN check_violation OR not_null_violation THEN rejected := true;
    END;
    PERFORM pg_temp.assert_setup(rejected,'invalid welcome payload rejected');
  END LOOP;
  rejected := false;
  BEGIN
    INSERT INTO public.webhook_retry_queue(webhook_type,target_id,payload)
      VALUES('facility_welcome',target,jsonb_build_object('user_id','68000000-0000-4000-8000-000000000001','template_version',1));
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  PERFORM pg_temp.assert_setup(rejected,'same facility welcome is unique');
END $$;
SELECT pg_temp.assert_setup((SELECT count(*)=1 FROM public.audit_logs WHERE user_id='68000000-0000-4000-8000-000000000001'
  AND new_values->>'license_warranted'='true'), 'no replay license duplicate');
SELECT pg_temp.assert_setup((SELECT outcome='already_member' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000001','legacy','69000000-0000-4000-8000-000000000002',NULL,NULL,clock_timestamp(),'{}',true)), 'same owner different receipt not consumed');
SELECT pg_temp.assert_setup((SELECT claimed_facility_id IS NULL AND claimed_by_user_id IS NULL FROM public.salons WHERE id='69000000-0000-4000-8000-000000000002'), 'second branch remains separate');
SELECT pg_temp.assert_setup((SELECT outcome='conflict' AND facility_id IS NULL FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000002','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',true)), 'other user cannot replay');
-- Direct signup is still allowed: unknown draft location is empty, not NULL.
SELECT pg_temp.assert_setup((SELECT outcome='created' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000002','none',NULL,NULL,NULL,NULL,'{"facility_name":"Synthetic direct","business_type":"ヘアサロン"}',true)), 'direct signup remains possible');
SELECT pg_temp.assert_setup((SELECT p.prefecture='' AND p.city='' AND p.address='' AND p.status='draft'
  FROM public.facility_profiles p JOIN public.facility_members m ON m.facility_id=p.id WHERE m.user_id='68000000-0000-4000-8000-000000000002'), 'draft missing location is explicit');
RESET ROLE;
-- Auth deletion clears user FK but MUST retain the consumed facility reference.
DELETE FROM auth.users WHERE id='68000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_setup((SELECT claimed_by_user_id IS NULL AND claimed_facility_id IS NOT NULL FROM public.salons WHERE id='69000000-0000-4000-8000-000000000001'), 'auth deletion preserves tombstone');
SELECT pg_temp.assert_setup((SELECT outcome='conflict' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000003','legacy','69000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',true)), 'deleted-owner receipt cannot be stolen');
UPDATE public.salons SET claimed_at=clock_timestamp() WHERE id='69000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_setup((SELECT outcome='conflict' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000003','legacy','69000000-0000-4000-8000-000000000002',NULL,NULL,clock_timestamp(),'{}',true)), 'incomplete legacy claim not inferred away');
UPDATE public.salons SET status='rejected' WHERE id='69000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_setup((SELECT outcome='unverified' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000003','legacy','69000000-0000-4000-8000-000000000003',NULL,NULL,clock_timestamp(),'{}',true)), 'rejected receipt refused');
RESET ROLE;
-- Force failure separately at each persistence boundary. Every exception must
-- escape and leave the entire operation absent, not a compensating-delete scar.
CREATE FUNCTION pg_temp.reject_setup_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'synthetic setup failure';
END $$;
DO $$ DECLARE tbl text; before_profiles bigint; before_members bigint; before_photos bigint; before_audit bigint; before_queue bigint; rejected boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['facility_profiles','facility_members','salons','facility_photos','audit_logs','webhook_retry_queue'] LOOP
    SELECT count(*) INTO before_profiles FROM public.facility_profiles;
    SELECT count(*) INTO before_members FROM public.facility_members;
    SELECT count(*) INTO before_photos FROM public.facility_photos;
    SELECT count(*) INTO before_audit FROM public.audit_logs;
    SELECT count(*) INTO before_queue FROM public.webhook_retry_queue;
    EXECUTE format('CREATE TRIGGER synthetic_setup_failure BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_setup_write()',tbl);
    rejected := false;
    BEGIN
      SET LOCAL ROLE service_role;
      PERFORM public.setup_facility_from_registration('68000000-0000-4000-8000-000000000004','legacy',
        '69000000-0000-4000-8000-000000000004',NULL,NULL,clock_timestamp(),'{}',true);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'synthetic setup failure' THEN RAISE; END IF;
      rejected := true;
    END;
    RESET ROLE;
    PERFORM pg_temp.assert_setup(rejected,'injected failure escaped: '||tbl);
    PERFORM pg_temp.assert_setup((SELECT count(*)=before_profiles FROM public.facility_profiles)
      AND (SELECT count(*)=before_members FROM public.facility_members)
      AND (SELECT count(*)=before_photos FROM public.facility_photos)
      AND (SELECT count(*)=before_audit FROM public.audit_logs)
      AND (SELECT count(*)=before_queue FROM public.webhook_retry_queue)
      AND (SELECT claimed_facility_id IS NULL AND claimed_by_user_id IS NULL AND claimed_at IS NULL
        FROM public.salons WHERE id='69000000-0000-4000-8000-000000000004'), 'all writes rolled back: '||tbl);
    EXECUTE format('DROP TRIGGER synthetic_setup_failure ON public.%I',tbl);
  END LOOP;
END $$;
-- v2 capability selects its committed receipt and the real optional photo slot.
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,
  payload_hmac,salon_id,committed_at,prepare_expires_at)
VALUES ('6a000000-0000-4000-8000-000000000001',repeat('a',64),1,'proof-hkdf-sha256-v1',
  repeat('b',64),'69000000-0000-4000-8000-000000000005',clock_timestamp(),clock_timestamp()+interval '1 day');
INSERT INTO public.salon_submission_photos(id,intent_id,selection_id,slot,mime_type,byte_size)
VALUES ('6b000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000001',gen_random_uuid(),4,'image/png',1);
UPDATE public.salons SET photo_urls=ARRAY['https://synthetic.example.invalid/storage/v1/object/public/carelink-uploads/salon-intents/6a000000-0000-4000-8000-000000000001/6b000000-0000-4000-8000-000000000001.png']
  WHERE id='69000000-0000-4000-8000-000000000005';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_setup((SELECT outcome='unverified' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000005','intent',NULL,'6a000000-0000-4000-8000-000000000001',repeat('f',64),NULL,'{}',true)), 'wrong v2 proof refused');
SELECT pg_temp.assert_setup((SELECT outcome='created' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000005','intent',NULL,'6a000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'v2 claim creates');
SELECT pg_temp.assert_setup((SELECT count(*)=1 AND bool_and(photo_type='menu') FROM public.facility_photos
  WHERE facility_id=(SELECT claimed_facility_id FROM public.salons WHERE id='69000000-0000-4000-8000-000000000005')), 'optional slot four remains menu, not exterior');
SELECT pg_temp.assert_setup((SELECT outcome='replay' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000005','intent',NULL,'6a000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'v2 replay');
UPDATE public.salon_submission_intents SET created_at=clock_timestamp()-interval '72 hours'
  WHERE id='6a000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_setup((SELECT outcome='unverified' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000005','intent',NULL,'6a000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'expired v2 replay denied');
RESET ROLE;
-- Location normalization (20261022120100). The case table between the markers
-- is also read by src/lib/__tests__/facility-location.test.ts and checked
-- against the TypeScript normalizeFacilityLocation, so both stay identical.
SELECT pg_temp.assert_setup(
  has_function_privilege('service_role','public.normalize_facility_location(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.normalize_facility_location(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.normalize_facility_location(text,text,text)','EXECUTE'),
  'location normalizer is service-only');
SET LOCAL ROLE service_role;
DO $$ DECLARE c record; got record; checked integer := 0;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    -- >>> facility-location cases (prefecture, city, address, expected city, expected address)
    ('大阪府','大阪市北区','大阪府大阪市北区梅田1-1-1','北区','梅田1-1-1'),
    ('大阪府','大阪市北区','梅田1-1-1','北区','梅田1-1-1'),
    ('大阪府','大阪市北区','北区梅田1-1-1','北区','梅田1-1-1'),
    ('大阪府','大阪市','大阪府大阪市北区梅田1-1-1','北区','梅田1-1-1'),
    ('大阪府','大阪市西淀川区','大阪府大阪市西淀川区御幣島1','西淀川区','御幣島1'),
    ('大阪府','大阪市','西淀川区御幣島1','西淀川区','御幣島1'),
    ('大阪府','大阪市','大阪府大阪市北区','北区',''),
    ('大阪府','大阪市','大阪府大阪市','大阪市',''),
    ('大阪府','大阪市梅田','梅田1','大阪市梅田','梅田1'),
    ('大阪府','堺市堺区','大阪府堺市堺区南瓦町3-1','堺市','堺区南瓦町3-1'),
    ('神奈川県','横浜市中区','神奈川県横浜市中区山下町1','横浜市','中区山下町1'),
    ('神奈川県','横浜市','神奈川県横浜市中区山下町1','横浜市','中区山下町1'),
    ('神奈川県','横浜市中区','中区山下町1','横浜市','中区山下町1'),
    ('神奈川県','横浜市中区','横浜市山下町1','横浜市','中区山下町1'),
    ('神奈川県',' 横浜市　中区 ',' 神奈川県 横浜市　中区 山下町1 ','横浜市','中区山下町1'),
    ('神奈川県','横浜市中区','神奈川県横浜市中区','横浜市中区',''),
    ('神奈川県','横浜市中区','神奈川県横浜市','横浜市中区',''),
    ('神奈川県','横浜市中区','','横浜市中区',''),
    ('神奈川県','横浜市中 区','山下町1','横浜市中 区','山下町1'),
    ('神奈川県','横浜市区','山下町1','横浜市区','山下町1'),
    ('神奈川県','横浜市緑町','山下町1','横浜市緑町','山下町1'),
    ('福岡県','北九州市小倉北区','福岡県北九州市小倉北区魚町1','北九州市','小倉北区魚町1'),
    ('静岡県','浜松市','静岡県浜松市中央区板屋町1','浜松市','中央区板屋町1'),
    ('京都府','京都市下京区','京都府京都市下京区烏丸通1','京都市','下京区烏丸通1'),
    ('北海道','札幌市中央区','北海道札幌市中央区北1条西2丁目','札幌市','中央区北1条西2丁目'),
    ('東京都','渋谷区','東京都渋谷区道玄坂1-2-3','渋谷区','道玄坂1-2-3'),
    ('東京都','渋谷区','渋谷区道玄坂1-2-3','渋谷区','道玄坂1-2-3'),
    ('東京都','渋谷区','道玄坂1-2-3','渋谷区','道玄坂1-2-3'),
    ('大阪府','豊中市','大阪府吹田市1','豊中市','吹田市1'),
    ('','渋谷区','東京都渋谷区道玄坂1','渋谷区','東京都渋谷区道玄坂1'),
    ('愛知県','合成市','合成町1','合成市','合成町1'),
    (NULL,NULL,NULL,'','')
    -- <<< facility-location cases
  ) AS cases(prefecture,city,address,expected_city,expected_address) LOOP
    SELECT * INTO got FROM public.normalize_facility_location(c.prefecture,c.city,c.address);
    IF got.city IS DISTINCT FROM c.expected_city OR got.address IS DISTINCT FROM c.expected_address THEN
      RAISE EXCEPTION 'facility setup fixture: location % / % / % -> % / %', c.prefecture,c.city,c.address,got.city,got.address;
    END IF;
    checked := checked + 1;
  END LOOP;
  PERFORM pg_temp.assert_setup(checked >= 20, 'location case table was read');
END $$;
RESET ROLE;
-- A receipt keeps the applicant's full address; the facility stores the
-- street part and the city master unit (no repeated prefecture/city).
INSERT INTO auth.users(id,email) VALUES
  ('68000000-0000-4000-8000-000000000007','synthetic-setup-7@example.invalid');
INSERT INTO public.salons(id,facility_name,business_type,representative_name,contact_name,email,phone,prefecture,city,address,seat_count,staff_count,has_parking,features,photo_urls,source)
VALUES
  ('69000000-0000-4000-8000-000000000006','Synthetic Osaka','ヘアサロン','Synthetic representative','Synthetic contact','synthetic-setup-6@example.invalid','09000000000',
   '大阪府','大阪市北区','大阪府大阪市北区合成町1-1',0,0,false,ARRAY['synthetic'],ARRAY['https://assets.example.invalid/synthetic-6.png'],'register'),
  ('69000000-0000-4000-8000-000000000007','Synthetic Yokohama','ヘアサロン','Synthetic representative','Synthetic contact','synthetic-setup-7@example.invalid','09000000000',
   '神奈川県','横浜市中区','神奈川県横浜市中区合成町2-2',0,0,false,ARRAY['synthetic'],ARRAY['https://assets.example.invalid/synthetic-7.png'],'register');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_setup((SELECT outcome='created' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000006','legacy','69000000-0000-4000-8000-000000000006',NULL,NULL,clock_timestamp(),'{}',true)), 'Osaka receipt creates');
SELECT pg_temp.assert_setup((SELECT p.prefecture='大阪府' AND p.city='北区' AND p.address='合成町1-1'
  FROM public.facility_profiles p JOIN public.salons s ON s.claimed_facility_id=p.id WHERE s.id='69000000-0000-4000-8000-000000000006'),
  'Osaka ward kept as city and address not repeated');
SELECT pg_temp.assert_setup((SELECT outcome='created' FROM public.setup_facility_from_registration(
  '68000000-0000-4000-8000-000000000007','legacy','69000000-0000-4000-8000-000000000007',NULL,NULL,clock_timestamp(),'{}',true)), 'Yokohama receipt creates');
SELECT pg_temp.assert_setup((SELECT p.prefecture='神奈川県' AND p.city='横浜市' AND p.address='中区合成町2-2'
  FROM public.facility_profiles p JOIN public.salons s ON s.claimed_facility_id=p.id WHERE s.id='69000000-0000-4000-8000-000000000007'),
  'designated city cut at the city and the ward kept in the address');
SELECT pg_temp.assert_setup((SELECT count(*)=2 FROM public.salons WHERE
  (id='69000000-0000-4000-8000-000000000006' AND city='大阪市北区' AND address='大阪府大阪市北区合成町1-1')
  OR (id='69000000-0000-4000-8000-000000000007' AND city='横浜市中区' AND address='神奈川県横浜市中区合成町2-2')),
  'receipts keep the submitted location');
RESET ROLE;

-- Medical categories must survive direct creation and registration receipt adoption.
-- This probes the real RPC, member binding, public view and search type column.
DO $medical$
DECLARE
  category text; mode text; actor uuid; receipt_id uuid; result record;
  categories text[] := ARRAY['病院','総合病院','診療所・クリニック（複数診療科）','内科','呼吸器内科','循環器内科','消化器内科','糖尿病内科','腎臓内科','脳神経内科','外科','整形外科','脳神経外科','形成外科','小児科','耳鼻咽喉科','眼科','皮膚科','泌尿器科','産婦人科','婦人科','精神科','心療内科','アレルギー科','リウマチ科','リハビリテーション科','歯科','小児歯科','矯正歯科','歯科口腔外科','その他の医療機関'];
BEGIN
  FOREACH category IN ARRAY categories LOOP
    FOREACH mode IN ARRAY ARRAY['none','legacy'] LOOP
      actor := gen_random_uuid(); receipt_id := NULL;
      INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
      IF mode='legacy' THEN
        receipt_id := gen_random_uuid();
        INSERT INTO public.salons(id,facility_name,business_type,representative_name,contact_name,email,phone,source)
          VALUES(receipt_id,'Synthetic medical fixture',category,'Synthetic','Synthetic',actor::text||'@example.invalid','09000000000','register');
      END IF;
      SELECT * INTO result FROM public.setup_facility_from_registration(actor,mode,receipt_id,NULL,NULL,
        CASE WHEN mode='legacy' THEN clock_timestamp() ELSE NULL END,
        CASE WHEN mode='none' THEN jsonb_build_object('facility_name','Synthetic medical fixture','business_type',category)
          ELSE '{}'::jsonb END,true);
      PERFORM pg_temp.assert_setup(result.outcome='created','medical create: '||mode||' / '||category);
      PERFORM pg_temp.assert_setup((SELECT business_type=category AND status='draft' FROM public.facility_profiles WHERE id=result.facility_id),
        'medical category preserved: '||category);
      PERFORM pg_temp.assert_setup((SELECT count(*)=1 FROM public.facility_members WHERE facility_id=result.facility_id AND user_id=actor AND role='owner'),
        'medical owner bound: '||category);
      -- Public read is checked with synthetic rows inside this rollback-only transaction.
      UPDATE public.facility_profiles SET status='published',prefecture='福岡県',city='福岡市',address='合成町1'
        WHERE id=result.facility_id;
      PERFORM pg_temp.assert_setup((SELECT count(*)=1 FROM public.facility_card_view WHERE id=result.facility_id AND business_type=category),
        'medical category public/searchable: '||category);
    END LOOP;
  END LOOP;
  actor := gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@example.invalid');
  SELECT * INTO result FROM public.setup_facility_from_registration(actor,'none',NULL,NULL,NULL,NULL,
    '{"facility_name":"Synthetic invalid clinic","business_type":"未定義の診療科"}',true);
  PERFORM pg_temp.assert_setup(result.outcome='invalid','unknown category still rejected');
END $medical$;
ROLLBACK;
\echo 'facility setup fixtures passed; all synthetic records rolled back'
