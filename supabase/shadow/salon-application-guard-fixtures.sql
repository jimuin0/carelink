-- Synthetic application-role writes only; no provider calls. All roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' THEN RAISE EXCEPTION 'disposable shadow required'; END IF;
  IF EXISTS(SELECT 1 FROM public.salon_submission_intents WHERE id::text LIKE 'ca120000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_application(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'application guard fixture: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.application_payload() RETURNS jsonb LANGUAGE sql AS $$
SELECT '{"facility_name":"Synthetic application guard","business_type":"ヘアサロン","representative_name":"Synthetic", "contact_name":"Synthetic","email":"application-guard@example.invalid","phone":"09000000000","features":[],"photo_urls":[],"source":"recruit"}'::jsonb;
$$;
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,prepare_expires_at)
SELECT ('ca120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),1,'proof-hkdf-sha256-v1',clock_timestamp()+interval '1 hour'
FROM generate_series(1,3) n;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    -- Supplying declaration columns is not a substitute for an owned intent.
    INSERT INTO public.salons(facility_name,business_type,representative_name,contact_name,email,phone,
      registration_terms_sha256,registration_terms_accepted_at,registration_license_warranted)
      VALUES('Synthetic legacy','ヘアサロン','Synthetic','Synthetic','legacy-guard@example.invalid','09000000000',repeat('c',64),now(),true);
    RAISE EXCEPTION 'legacy direct application insert accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REGISTRATION_INTENT_AND_CONSENT_REQUIRED' THEN RAISE; END IF; END;
  BEGIN
    PERFORM * FROM public.commit_salon_submission('ca120000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload());
    RAISE EXCEPTION 'legacy fresh commit accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REGISTRATION_INTENT_AND_CONSENT_REQUIRED' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_application((SELECT salon_id IS NULL FROM public.salon_submission_intents WHERE id='ca120000-0000-4000-8000-000000000001'),'legacy failure leaves intent uncommitted');
  PERFORM pg_temp.assert_application(NOT EXISTS(SELECT 1 FROM public.salons WHERE email IN ('legacy-guard@example.invalid','application-guard@example.invalid')),'legacy failure leaves no registration');
END $$;
SELECT pg_temp.assert_application((SELECT outcome='committed' FROM public.commit_salon_submission_with_consent(
 'ca120000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload(),repeat('c',64))),'explicit declaration commits');
SELECT pg_temp.assert_application(coalesce(current_setting('carelink.salon_registration_context',true),'')='','application context restored after commit');
SELECT pg_temp.assert_application((SELECT s.registration_terms_sha256=repeat('c',64) AND s.registration_license_warranted IS TRUE
  AND s.registration_terms_accepted_at IS NOT NULL AND s.status='pending' AND s.is_public=false
  FROM public.salons s JOIN public.salon_submission_intents i ON i.salon_id=s.id WHERE i.id='ca120000-0000-4000-8000-000000000001'),'declaration is recorded without publishing');
SELECT pg_temp.assert_application((SELECT outcome='replay' FROM public.commit_salon_submission(
 'ca120000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload())),'historical exact replay remains available');
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.commit_salon_submission('ca120000-0000-4000-8000-000000000002',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload());
    RAISE EXCEPTION 'declaration context leaked to next intent';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REGISTRATION_INTENT_AND_CONSENT_REQUIRED' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_application((SELECT outcome='unverified' FROM public.commit_salon_submission_with_consent(
 'ca120000-0000-4000-8000-000000000002',repeat('f',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload(),repeat('c',64))),'declaration cannot replace capability verification');
SELECT pg_temp.assert_application(coalesce(current_setting('carelink.salon_registration_context',true),'')='','unverified call restores context');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_application_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM public.salon_submission_intents i WHERE i.id='ca120000-0000-4000-8000-000000000003'
  AND i.salon_id=NEW.registration_id) THEN RAISE EXCEPTION 'SYNTHETIC_APPLICATION_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_application_outbox_failure BEFORE INSERT ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_application_outbox();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.commit_salon_submission_with_consent('ca120000-0000-4000-8000-000000000003',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.application_payload(),repeat('c',64));
    RAISE EXCEPTION 'partial declaration commit accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_APPLICATION_OUTBOX_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_application((SELECT salon_id IS NULL FROM public.salon_submission_intents WHERE id='ca120000-0000-4000-8000-000000000003'),'outbox failure leaves intent uncommitted');
  PERFORM pg_temp.assert_application(coalesce(current_setting('carelink.salon_registration_context',true),'')='','failed call restores context');
END $$;
ROLLBACK;
