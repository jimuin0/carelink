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
ROLLBACK;
\echo 'facility setup fixtures passed; all synthetic records rolled back'
