-- CI's disposable schema database only. No network calls or real applicants.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' OR EXISTS (SELECT 1 FROM public.salons)
    OR EXISTS (SELECT 1 FROM public.salon_submission_intents) THEN
    RAISE EXCEPTION 'registration fixtures require empty disposable carelink_shadow';
  END IF;
END $$;

CREATE FUNCTION pg_temp.assert_registration(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'registration fixture failed: %', label; END IF;
END $$;
-- An invocation can fail on table privileges even when EXECUTE is accidentally
-- granted. Assert the function ACL itself, separately from the runtime denial.
SELECT pg_temp.assert_registration(
  NOT has_function_privilege('anon', 'public.commit_salon_submission(uuid,text,smallint,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.commit_salon_submission(uuid,text,smallint,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.commit_salon_submission(uuid,text,smallint,text,text,jsonb)', 'EXECUTE'),
  'RPC execute ACL is service-only');
CREATE FUNCTION pg_temp.registration_payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"facility_name":"Synthetic registration fixture","business_type":"ヘアサロン",
    "representative_name":"Synthetic representative","contact_name":"Synthetic contact",
    "email":"registration-fixture@example.invalid","phone":"09000000000",
    "address":"愛知県西尾市合成町","prefecture":"愛知県","city":"西尾市",
    "features":[],"photo_urls":[],"has_parking":false,"seat_count":0,"staff_count":0,
    "desired_start_date":"undecided","source":"register"}'::jsonb
$$;
INSERT INTO public.salon_submission_intents
  (id, proof_hash, canonical_version, hmac_scheme, created_at, prepare_expires_at)
SELECT ('61000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, repeat('a',64),
  1, 'proof-hkdf-sha256-v1', now() - interval '2 days',
  CASE WHEN n=3 THEN now() - interval '1 day' ELSE now() + interval '1 day' END
FROM generate_series(1,4) n;

-- Actual role invocation: rejected even when the intent exists and all inputs
-- (including the synthetic proof) are known. RLS alone is not the RPC ACL.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.commit_salon_submission('61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),'{}'::jsonb);
    RAISE EXCEPTION 'anon executed registration RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.salon_submission_intents;
    RAISE EXCEPTION 'anon read registration proof digests';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.commit_salon_submission('61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),'{}'::jsonb);
    RAISE EXCEPTION 'authenticated executed registration RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.salon_submission_intents (id, proof_hash, canonical_version, hmac_scheme, prepare_expires_at)
      VALUES (gen_random_uuid(), repeat('a',64), 1, 'proof-hkdf-sha256-v1', now()+interval '1 day');
    RAISE EXCEPTION 'authenticated created an intent';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000001',repeat('f',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'wrong proof exposes no receipt');
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000099',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'unknown intent has same response');
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000001',repeat('a',64),2::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'canonical version is bound to intent');
SELECT pg_temp.assert_registration(
  (SELECT outcome='expired' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000003',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'uncommitted expired intent cannot create a receipt');
SELECT pg_temp.assert_registration(
  (SELECT outcome='committed' AND receipt_id IS NOT NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),
    pg_temp.registration_payload() || '{"is_public":true,"status":"published","claimed_by_user_id":"62000000-0000-4000-8000-000000000001"}'::jsonb)),
  'service role commits valid registration');
SELECT pg_temp.assert_registration(
  (SELECT count(*)=1 AND bool_and(is_public=false AND claimed_by_user_id IS NULL AND seat_count=0 AND desired_start_date='undecided') FROM public.salons),
  'input cannot set publication or claim and optional values persist');
SELECT pg_temp.assert_registration(
  (SELECT count(*)=2 AND count(DISTINCT notification_kind)=2 AND bool_and(payload='{}'::jsonb AND target_id=registration_id::text) FROM public.webhook_retry_queue),
  'register creates two typed non-PII outbox references');
UPDATE public.salon_submission_intents SET prepare_expires_at=now()-interval '1 day'
  WHERE id='61000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_registration(
  (SELECT outcome='replay' AND receipt_id=(SELECT salon_id FROM public.salon_submission_intents WHERE id='61000000-0000-4000-8000-000000000001')
    FROM public.commit_salon_submission('61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'lost response retry preserves receipt even after preparation expiry');
SELECT pg_temp.assert_registration(
  (SELECT outcome='conflict' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('c',64),pg_temp.registration_payload())),
  'different content cannot overwrite a committed receipt');
SELECT pg_temp.assert_registration((SELECT count(*)=1 FROM public.salons) AND (SELECT count(*)=2 FROM public.webhook_retry_queue),
  'replay/conflict do not duplicate either business row or notifications');
-- A copied cookie cannot extend access by replaying after the server deadline.
-- This is already committed, so the gate must run BEFORE the replay branch.
UPDATE public.salon_submission_intents SET created_at=clock_timestamp()-interval '72 hours'
  WHERE id='61000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'committed capability cannot replay at or beyond its three-day deadline');
INSERT INTO public.salon_submission_intents
  (id, proof_hash, canonical_version, hmac_scheme, created_at, prepare_expires_at)
VALUES
  ('61000000-0000-4000-8000-000000000005',repeat('a',64),1,'proof-hkdf-sha256-v1',now()-interval '4 days',now()+interval '2 days'),
  ('61000000-0000-4000-8000-000000000006',repeat('a',64),1,'proof-hkdf-sha256-v1',now()+interval '1 day',now()+interval '2 days');
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000005',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'long preparation window cannot extend capability lifetime');
SELECT pg_temp.assert_registration(
  (SELECT outcome='unverified' AND receipt_id IS NULL FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000006',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload())),
  'future issue time is rejected');
SELECT pg_temp.assert_registration((SELECT count(*)=1 FROM public.salons) AND (SELECT count(*)=2 FROM public.webhook_retry_queue)
  AND (SELECT count(*)=2 FROM public.salon_submission_intents
    WHERE id IN ('61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000006') AND salon_id IS NULL),
  'capability rejection does not create receipts or outbox entries');
SELECT pg_temp.assert_registration(
  (SELECT outcome='committed' FROM public.commit_salon_submission(
    '61000000-0000-4000-8000-000000000002',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('c',64),
    pg_temp.registration_payload() || '{"source":"recruit"}'::jsonb)), 'distinct intent is distinct receipt');
SELECT pg_temp.assert_registration((SELECT count(*)=2 FROM public.salons) AND (SELECT count(*)=3 FROM public.webhook_retry_queue),
  'recruit adds only the internal notification');
RESET ROLE;

-- Fail the second outbox insertion, after salon + intent + first outbox writes.
CREATE FUNCTION pg_temp.reject_registration_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.webhook_type='salon_registration_email' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_reject_registration_receipt BEFORE INSERT ON public.webhook_retry_queue
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_registration_receipt();
SET LOCAL ROLE service_role;
DO $$ DECLARE failed boolean := false; BEGIN
  BEGIN
    PERFORM public.commit_salon_submission('61000000-0000-4000-8000-000000000004',repeat('a',64),1::smallint,
      'proof-hkdf-sha256-v1',repeat('b',64),pg_temp.registration_payload());
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'synthetic outbox failure' THEN RAISE; END IF;
    failed := true;
  END;
  PERFORM pg_temp.assert_registration(failed, 'outbox error must escape RPC');
END $$;
SELECT pg_temp.assert_registration((SELECT count(*)=2 FROM public.salons) AND (SELECT count(*)=3 FROM public.webhook_retry_queue)
  AND (SELECT salon_id IS NULL AND payload_hmac IS NULL AND committed_at IS NULL FROM public.salon_submission_intents
    WHERE id='61000000-0000-4000-8000-000000000004'), 'outbox failure rolls back every write');
RESET ROLE;

ROLLBACK;
\echo 'registration intent fixtures passed (synthetic transaction rolled back)'
