-- Disposable PG17 only. No provider/SMTP/real applicant calls. All rows roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT IN ('carelink_shadow','carelink_shadow_batch2_auth')
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    THEN RAISE EXCEPTION 'isolated consent fixture database required'; END IF;
  IF EXISTS(SELECT 1 FROM public.salon_submission_intents WHERE id::text LIKE 'c8010000-%')
    THEN RAISE EXCEPTION 'synthetic consent fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_consent(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'consent receipt fixture: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.consent_payload() RETURNS jsonb LANGUAGE sql AS $$
SELECT '{"facility_name":"Synthetic consent receipt","business_type":"ヘアサロン",
"representative_name":"Synthetic representative","contact_name":"Synthetic contact",
"email":"synthetic-consent@example.invalid","phone":"09000000000","address":"検証県検証市検証町",
"prefecture":"検証県","city":"検証市","features":[],"photo_urls":[],"has_parking":false,
"seat_count":0,"staff_count":0,"source":"register"}'::jsonb;
$$;
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,prepare_expires_at)
SELECT ('c8010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),1,'proof-hkdf-sha256-v1',clock_timestamp()+interval '1 hour'
FROM generate_series(1,5) n;
SELECT pg_temp.assert_consent(NOT has_function_privilege('anon','public.commit_salon_submission_with_consent(uuid,text,smallint,text,text,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.commit_salon_submission_with_consent(uuid,text,smallint,text,text,jsonb,text)','EXECUTE')
  AND has_function_privilege('service_role','public.commit_salon_submission_with_consent(uuid,text,smallint,text,text,jsonb,text)','EXECUTE'),'wrapper service-only');

CREATE TEMP TABLE consent_receipt_snapshot(receipt uuid,edition text,accepted_at timestamptz);
GRANT ALL ON pg_temp.consent_receipt_snapshot TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.consent_receipt_snapshot
SELECT c.receipt_id,NULL,NULL FROM
 public.commit_salon_submission_with_consent('c8010000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,
 'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('c',64)) c
 WHERE c.outcome='committed';
UPDATE pg_temp.consent_receipt_snapshot t SET edition=s.registration_terms_sha256,
  accepted_at=s.registration_terms_accepted_at FROM public.salons s WHERE s.id=t.receipt;
SELECT pg_temp.assert_consent((SELECT count(*)=1 AND bool_and(edition=repeat('c',64) AND accepted_at IS NOT NULL)
 FROM pg_temp.consent_receipt_snapshot),'receipt declaration recorded with server time');
SELECT pg_temp.assert_consent((SELECT outcome='replay' FROM public.commit_salon_submission_with_consent(
 'c8010000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('d',64))),
 'exact business replay does not require the old policy edition');
SELECT pg_temp.assert_consent((SELECT s.registration_terms_sha256=t.edition AND s.registration_terms_accepted_at=t.accepted_at
 AND s.registration_license_warranted IS TRUE FROM public.salons s JOIN pg_temp.consent_receipt_snapshot t ON t.receipt=s.id),
 'replay cannot overwrite original declaration edition/time');
SELECT pg_temp.assert_consent((SELECT outcome='conflict' FROM public.commit_salon_submission_with_consent(
 'c8010000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('e',64),pg_temp.consent_payload(),repeat('c',64))),
 'original business HMAC conflict preserved');
SELECT pg_temp.assert_consent((SELECT outcome='unverified' FROM public.commit_salon_submission_with_consent(
 'c8010000-0000-4000-8000-000000000003',repeat('f',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('c',64))),
 'wrong capability does not record an agreement');

-- Legacy grace remains callable; a later new wrapper replay does not backfill it.
SELECT * FROM public.commit_salon_submission('c8010000-0000-4000-8000-000000000002',repeat('a',64),1::smallint,
 'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload());
SELECT * FROM public.commit_salon_submission_with_consent('c8010000-0000-4000-8000-000000000002',repeat('a',64),1::smallint,
 'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('c',64));
SELECT pg_temp.assert_consent((SELECT s.registration_terms_sha256 IS NULL AND s.registration_terms_accepted_at IS NULL
 AND s.registration_license_warranted IS NULL FROM public.salons s JOIN public.salon_submission_intents i ON i.salon_id=s.id
 WHERE i.id='c8010000-0000-4000-8000-000000000002'),'legacy replay is not a new consent record');
DO $$ BEGIN
 BEGIN PERFORM public.commit_salon_submission_with_consent('c8010000-0000-4000-8000-000000000003',repeat('a',64),1::smallint,
  'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),NULL); RAISE EXCEPTION 'missing edition accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REGISTRATION_CONSENT_VERSION_REQUIRED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

-- A late declaration write failure rolls back receipt + intent + notification,
-- not merely the added columns. The original comparison stays usable for retry.
CREATE FUNCTION pg_temp.fail_consent_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.email='synthetic-consent@example.invalid' THEN RAISE EXCEPTION 'SYNTHETIC_CONSENT_RECORD_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_consent_record_failure BEFORE UPDATE OF registration_terms_sha256 ON public.salons
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_consent_record();
SET LOCAL ROLE service_role;
DO $$ DECLARE before_receipts int; before_queue int; BEGIN
 SELECT count(*) INTO before_receipts FROM public.salons;
 SELECT count(*) INTO before_queue FROM public.webhook_retry_queue;
 BEGIN PERFORM public.commit_salon_submission_with_consent('c8010000-0000-4000-8000-000000000004',repeat('a',64),1::smallint,
  'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('c',64)); RAISE EXCEPTION 'partial declaration committed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_CONSENT_RECORD_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_consent((SELECT count(*)=before_receipts FROM public.salons)
  AND (SELECT count(*)=before_queue FROM public.webhook_retry_queue)
  AND (SELECT salon_id IS NULL AND payload_hmac IS NULL FROM public.salon_submission_intents
    WHERE id='c8010000-0000-4000-8000-000000000004'),'declaration failure rolls back all registration writes');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_consent_record_failure ON public.salons;
SET LOCAL ROLE service_role;
SELECT * FROM public.commit_salon_submission_with_consent('c8010000-0000-4000-8000-000000000004',repeat('a',64),1::smallint,
 'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.consent_payload(),repeat('c',64));
DO $$ BEGIN
 BEGIN UPDATE public.salons SET registration_terms_sha256=NULL WHERE id=(SELECT salon_id FROM public.salon_submission_intents
  WHERE id='c8010000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'partial nullable declaration accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'consent receipt/replay/grace/ACL/rollback checks passed';
ROLLBACK;
