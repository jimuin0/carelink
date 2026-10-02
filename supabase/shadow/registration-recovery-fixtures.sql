-- Synthetic records only; private disposable shadow DB, transaction rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable carelink_shadow required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_recovery(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'registration recovery fixture: %',label; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'recovery-'||n||'@example.invalid',CASE WHEN n=3 THEN NULL ELSE clock_timestamp() END
FROM generate_series(1,6) n;
INSERT INTO public.salons(id,facility_name,business_type,email,phone,representative_name,contact_name,source,address,prefecture,city)
SELECT ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic recovery '||n,
  'ヘアサロン',CASE WHEN n=2 THEN 'recovery-2@example.invalid' WHEN n=3 THEN 'recovery-3@example.invalid' ELSE ' RECOVERY-1@example.invalid ' END,
  '09000000000','Synthetic','Synthetic','register','Original location','合成県','合成市'
FROM generate_series(1,58) n;
UPDATE public.salons SET source='recruit' WHERE id='a2000000-0000-4000-8000-000000000057';
UPDATE public.salons SET status='rejected' WHERE id='a2000000-0000-4000-8000-000000000058';
SELECT pg_temp.assert_recovery(
  NOT has_table_privilege('service_role','public.salon_recovery_grants','UPDATE')
  AND NOT has_table_privilege('service_role','public.salon_recovery_grants','DELETE')
  AND NOT has_table_privilege('anon','public.salon_recovery_grants','SELECT')
  AND NOT has_table_privilege('authenticated','public.salon_recovery_grants','SELECT'), 'grant immutability and private read ACL');
DO $$ DECLARE signature text; role_name text; denied boolean; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.registration_verified_account(uuid,uuid)',
    'public.list_recoverable_salon_receipts(uuid,uuid)',
    'public.prepare_salon_recovery(uuid,uuid,uuid,text)',
    'public.read_salon_recovery(uuid,uuid,text)'] LOOP
    PERFORM pg_temp.assert_recovery(has_function_privilege('service_role',signature,'EXECUTE'),'service execute '||signature);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.assert_recovery(NOT has_function_privilege(role_name,signature,'EXECUTE'),'denied '||role_name||' '||signature);
    END LOOP;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_recovery((SELECT count(*)=51 FROM public.list_recoverable_salon_receipts('a1000000-0000-4000-8000-000000000001',NULL)), 'bounded first page');
SELECT pg_temp.assert_recovery((SELECT count(*)=4 FROM public.list_recoverable_salon_receipts('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000052')), 'keyset tail excludes rejected and other source');
DO $$ BEGIN
  BEGIN
    PERFORM public.list_recoverable_salon_receipts('a1000000-0000-4000-8000-000000000003',NULL);
    RAISE EXCEPTION 'unconfirmed list accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'REGISTRATION_ACCOUNT_UNVERIFIED' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.prepare_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002',repeat('a',64))), 'other email denied');
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.prepare_salon_recovery(
  'a1000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000003',repeat('a',64))), 'unconfirmed denied');
SELECT pg_temp.assert_recovery((SELECT outcome='prepared' FROM public.prepare_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'verified exact lower trim accepted');
SELECT pg_temp.assert_recovery((SELECT count(*)=0 FROM public.facility_members WHERE user_id='a1000000-0000-4000-8000-000000000001'), 'prepare does not create facility');
SELECT pg_temp.assert_recovery((SELECT outcome='prepared' FROM public.prepare_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'same grant replay');
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.prepare_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'grant cannot switch receipt');
SELECT pg_temp.assert_recovery((SELECT outcome='confirmed' AND address='Original location' FROM public.read_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'summary works with SELECT INSERT only');
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.read_salon_recovery(
  'a1000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'grant bound to user');
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.read_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('b',64))), 'wrong proof denied');
RESET ROLE;
UPDATE auth.users SET email='changed@example.invalid' WHERE id='a1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.read_salon_recovery(
  'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('a',64))), 'current Auth email revokes grant');
RESET ROLE;
UPDATE auth.users SET email='recovery-1@example.invalid' WHERE id='a1000000-0000-4000-8000-000000000001';
-- Original capability has expired, but its photo manifest remains authoritative.
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,payload_hmac,salon_id,committed_at,created_at,prepare_expires_at)
VALUES('a4000000-0000-4000-8000-000000000001',repeat('c',64),1,'proof-hkdf-sha256-v1',repeat('d',64),
  'a2000000-0000-4000-8000-000000000001',clock_timestamp()-interval '80 hours',clock_timestamp()-interval '80 hours',clock_timestamp()-interval '79 hours');
INSERT INTO public.salon_submission_photos(id,intent_id,selection_id,slot,mime_type,byte_size)
VALUES('a5000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',gen_random_uuid(),4,'image/png',1);
UPDATE public.salons SET photo_urls=ARRAY['https://assets.example.invalid/storage/v1/object/public/carelink-uploads/salon-intents/a4000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000001.png']
WHERE id='a2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_recovery((SELECT outcome='invalid' FROM public.setup_facility_from_registration(
  'a1000000-0000-4000-8000-000000000001','recovered',NULL,'a3000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',false)), 'explicit license required');
SELECT pg_temp.assert_recovery((SELECT outcome='created' FROM public.setup_facility_from_registration(
  'a1000000-0000-4000-8000-000000000001','recovered',NULL,'a3000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{"facility_name":"Wrong override"}',true)), 'verified recovery creates atomically');
SELECT pg_temp.assert_recovery((SELECT p.name='Synthetic recovery 1' AND p.address='Original location' AND p.status='draft'
  FROM public.facility_profiles p JOIN public.salons s ON s.claimed_facility_id=p.id WHERE s.id='a2000000-0000-4000-8000-000000000001'), 'original information retained, no automatic publish');
SELECT pg_temp.assert_recovery((SELECT bool_and(photo_type='menu') AND count(*)=1 FROM public.facility_photos
  WHERE facility_id=(SELECT claimed_facility_id FROM public.salons WHERE id='a2000000-0000-4000-8000-000000000001')), 'expired original intent retains optional photo slot');
SELECT pg_temp.assert_recovery((SELECT outcome='replay' FROM public.setup_facility_from_registration(
  'a1000000-0000-4000-8000-000000000001','recovered',NULL,'a3000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'lost response replays');
SELECT pg_temp.assert_recovery((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome' AND
  payload->>'user_id'='a1000000-0000-4000-8000-000000000001'), 'no welcome duplication');
SELECT pg_temp.assert_recovery((SELECT created_at<clock_timestamp()-interval '72 hours' AND proof_hash=repeat('c',64)
  FROM public.salon_submission_intents WHERE id='a4000000-0000-4000-8000-000000000001'), 'original capability not extended or reset');
RESET ROLE;
-- Simulate expiration with privileged fixture setup, not application UPDATE.
UPDATE public.salon_recovery_grants SET created_at=created_at-interval '80 hours',expires_at=expires_at-interval '80 hours'
WHERE id='a3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_recovery((SELECT outcome='unverified' FROM public.setup_facility_from_registration(
  'a1000000-0000-4000-8000-000000000001','recovered',NULL,'a3000000-0000-4000-8000-000000000001',repeat('a',64),NULL,'{}',true)), 'expired grant denies even replay');
RESET ROLE;
DELETE FROM auth.users WHERE id='a1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_recovery((SELECT user_id IS NULL FROM public.salon_recovery_grants WHERE id='a3000000-0000-4000-8000-000000000001'), 'Auth deletion invalidates immutable grant without blocking');
SELECT pg_temp.assert_recovery((SELECT claimed_by_user_id IS NULL AND claimed_facility_id IS NOT NULL FROM public.salons
  WHERE id='a2000000-0000-4000-8000-000000000001'), 'receipt tombstone retained on Auth deletion');
ROLLBACK;
\echo 'registration recovery role, exact email, pagination, expiry, replay, photo and deletion fixtures passed; all records rolled back'
