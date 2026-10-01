-- Synthetic, rollback-only, disposable DB. No provider calls or real records.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_duplicate(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'duplicate linkage fixture: %',label; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'duplicate-'||n||'@example.invalid',clock_timestamp()
FROM generate_series(1,4)n;
UPDATE public.profiles SET is_platform_admin=true WHERE id='b1000000-0000-4000-8000-000000000001';
INSERT INTO public.salons(id,facility_name,business_type,email,phone,representative_name,contact_name,source,prefecture,city,address,building_name,photo_urls)
SELECT ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic branch','ヘアサロン','duplicate-2@example.invalid',
 '090-0000-0000','Synthetic','Synthetic','register','合成県','合成市','合成住所','合成建物',ARRAY['https://assets.example.invalid/retained.png']
FROM generate_series(1,10)n;
SELECT pg_temp.assert_duplicate(NOT has_table_privilege('service_role','public.salon_duplicate_links','UPDATE')
 AND NOT has_table_privilege('service_role','public.salon_duplicate_links','DELETE')
 AND NOT has_table_privilege('anon','public.salon_duplicate_links','SELECT')
 AND NOT has_table_privilege('authenticated','public.salon_duplicate_links','SELECT'), 'private immutable linkage');
SELECT pg_temp.assert_duplicate(has_function_privilege('service_role','public.link_duplicate_registration(uuid,uuid,uuid,boolean,integer,integer,boolean)','EXECUTE')
 AND NOT has_function_privilege('anon','public.link_duplicate_registration(uuid,uuid,uuid,boolean,integer,integer,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.link_duplicate_registration(uuid,uuid,uuid,boolean,integer,integer,boolean)','EXECUTE'), 'service-only RPC');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate((SELECT outcome='created' FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000002','legacy','b2000000-0000-4000-8000-000000000001',NULL,NULL,clock_timestamp(),'{}',true)), 'canonical setup');
CREATE FUNCTION pg_temp.link_duplicate(n integer,commit boolean DEFAULT false,dr integer DEFAULT 0,cr integer DEFAULT 1,confirmed boolean DEFAULT true,actor uuid DEFAULT 'b1000000-0000-4000-8000-000000000001')
RETURNS text LANGUAGE sql AS $$ SELECT public.link_duplicate_registration(actor,('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'b2000000-0000-4000-8000-000000000001',commit,dr,cr,confirmed)->>'outcome'; $$;
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2,false,0,1,true,'b1000000-0000-4000-8000-000000000003')='forbidden','DB authorization');
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(1)='invalid','self linkage denied');
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2)='preview' AND (SELECT count(*)=0 FROM public.salon_duplicate_links),'preview never writes');
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2,true,0,0)='conflict','stale CAS denied');
RESET ROLE;
UPDATE public.salons SET address='Other branch' WHERE id='b2000000-0000-4000-8000-000000000003';
UPDATE public.salons SET building_name='Other room' WHERE id='b2000000-0000-4000-8000-000000000004';
UPDATE public.salons SET email='duplicate-3@example.invalid' WHERE id='b2000000-0000-4000-8000-000000000005';
UPDATE public.salons SET address=NULL WHERE id='b2000000-0000-4000-8000-000000000006';
UPDATE public.salons SET phone='---' WHERE id='b2000000-0000-4000-8000-000000000007';
UPDATE public.salons SET claimed_at=clock_timestamp() WHERE id='b2000000-0000-4000-8000-000000000008';
SET LOCAL ROLE service_role;
DO $$ DECLARE n integer; BEGIN FOR n IN 3..8 LOOP
 PERFORM pg_temp.assert_duplicate(pg_temp.link_duplicate(n)='conflict','branch/room/email/missing/phone/partial claim denied '||n);
END LOOP; END $$;
RESET ROLE;
UPDATE auth.users SET email='changed@example.invalid' WHERE id='b1000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2)='conflict','current email required');
RESET ROLE;
UPDATE auth.users SET email='duplicate-2@example.invalid' WHERE id='b1000000-0000-4000-8000-000000000002';
-- Identical Unicode whitespace is still missing identity, not a valid match.
SAVEPOINT unicode_identity;
UPDATE public.salons SET address=U&'\0009\000A\00A0\3000' WHERE id IN
 ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
UPDATE public.facility_profiles SET address=U&'\0009\000A\00A0\3000'
 WHERE id=(SELECT claimed_facility_id FROM public.salons WHERE id='b2000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2)='conflict','Unicode whitespace cannot identify a physical location');
ROLLBACK TO unicode_identity;
CREATE FUNCTION pg_temp.fail_duplicate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.table_name='salon_duplicate_links' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER synthetic_duplicate_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_duplicate_audit();
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN
 PERFORM pg_temp.link_duplicate(2,true); RAISE EXCEPTION 'audit failure accepted';
EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'synthetic audit failure' THEN RAISE; END IF; END;
PERFORM pg_temp.assert_duplicate((SELECT count(*)=0 FROM public.salon_duplicate_links),'audit failure rolls back linkage'); END $$;
RESET ROLE;
DROP TRIGGER synthetic_duplicate_audit_failure ON public.audit_logs;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2,true,0,1,false)='conflict','explicit same-site confirmation');
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2,true)='linked' AND pg_temp.link_duplicate(2,true)='replay','atomic link and exact replay');
RESET ROLE;
UPDATE public.facility_profiles SET name='Changed legitimately',phone='09011111111'
 WHERE id=(SELECT claimed_facility_id FROM public.salons WHERE id='b2000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate(pg_temp.link_duplicate(2)='replay','immutable record remains reconcilable after settings edit');
SELECT pg_temp.assert_duplicate((SELECT count(*)=1 FROM public.audit_logs WHERE table_name='salon_duplicate_links'),'one atomic audit');
SELECT pg_temp.assert_duplicate((SELECT claimed_at IS NULL AND claimed_by_user_id IS NULL AND claimed_facility_id IS NULL
 AND photo_urls=ARRAY['https://assets.example.invalid/retained.png'] AND review_revision=0 FROM public.salons
 WHERE id='b2000000-0000-4000-8000-000000000002'),'original receipt and photographs unchanged');
SELECT pg_temp.assert_duplicate((SELECT outcome='linked' FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000002','legacy','b2000000-0000-4000-8000-000000000002',NULL,NULL,clock_timestamp(),'{}',true)), 'legacy resolves alias');
SELECT pg_temp.assert_duplicate((SELECT outcome='conflict' AND facility_id IS NULL FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000003','legacy','b2000000-0000-4000-8000-000000000002',NULL,NULL,clock_timestamp(),'{}',true)), 'other capability user no ID');
SELECT pg_temp.assert_duplicate((SELECT outcome='prepared' FROM public.prepare_salon_recovery(
 'b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001',repeat('a',64))), 'recovered alias preparation');
SELECT pg_temp.assert_duplicate((SELECT outcome='linked' FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000002','recovered',NULL,'b3000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'recovered resolves alias');
RESET ROLE;
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,payload_hmac,salon_id,committed_at,prepare_expires_at)
 VALUES('b4000000-0000-4000-8000-000000000001',repeat('c',64),1,'proof-hkdf-sha256-v1',repeat('d',64),'b2000000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp()+interval '1 hour');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate((SELECT outcome='linked' FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000002','intent',NULL,'b4000000-0000-4000-8000-000000000001',repeat('c',64),NULL,'{}',true)), 'intent resolves alias');
SELECT pg_temp.assert_duplicate((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome'
 AND payload->>'user_id'='b1000000-0000-4000-8000-000000000002'), 'no duplicate welcome');
RESET ROLE;
UPDATE public.facility_members SET role='admin' WHERE user_id='b1000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_duplicate((SELECT outcome='conflict' FROM public.setup_facility_from_registration(
 'b1000000-0000-4000-8000-000000000002','legacy','b2000000-0000-4000-8000-000000000002',NULL,NULL,clock_timestamp(),'{}',true)), 'owner revocation');
RESET ROLE;
DELETE FROM auth.users WHERE id='b1000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_duplicate((SELECT owner_id IS NULL FROM public.salon_duplicate_links),'deleted owner invalidated tombstone');
ROLLBACK;
\echo 'duplicate linkage ACL, CAS, identity, rollback, all setup modes, replay and owner revocation passed; all records rolled back'
