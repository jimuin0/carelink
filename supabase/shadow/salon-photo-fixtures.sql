-- Synthetic manifest contracts; actual Storage uploads are a separate gate.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow'
    OR EXISTS (SELECT 1 FROM public.salon_submission_intents)
    OR EXISTS (SELECT 1 FROM public.salon_submission_photos) THEN
    RAISE EXCEPTION 'photo fixtures require empty disposable carelink_shadow';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_photo(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'photo fixture failed: %', label; END IF;
END $$;
SELECT pg_temp.assert_photo(
  NOT has_function_privilege('anon','public.prepare_salon_photo(uuid,text,uuid,smallint,text,bigint)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.prepare_salon_photo(uuid,text,uuid,smallint,text,bigint)','EXECUTE')
  AND has_function_privilege('service_role','public.prepare_salon_photo(uuid,text,uuid,smallint,text,bigint)','EXECUTE'),
  'photo RPC service-only execute ACL');
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_salon_photo(gen_random_uuid(),repeat('a',64),gen_random_uuid(),0::smallint,'image/png',1::bigint);
    RAISE EXCEPTION 'anon invoked photo RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.salon_submission_photos;
    RAISE EXCEPTION 'anon read photo manifest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_salon_photo(gen_random_uuid(),repeat('a',64),gen_random_uuid(),0::smallint,'image/png',1::bigint);
    RAISE EXCEPTION 'authenticated invoked photo RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.salon_submission_photos;
    RAISE EXCEPTION 'authenticated read photo manifest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,prepare_expires_at)
VALUES ('64000000-0000-4000-8000-000000000001',repeat('a',64),1,'proof-hkdf-sha256-v1',now()+interval '1 day'),
  ('64000000-0000-4000-8000-000000000002',repeat('b',64),1,'proof-hkdf-sha256-v1',now()+interval '1 day');

SELECT pg_temp.assert_photo((SELECT outcome='unverified' AND photo_id IS NULL AND object_path IS NULL
  FROM public.prepare_salon_photo('64000000-0000-4000-8000-000000000099',repeat('a',64),gen_random_uuid(),0::smallint,'image/png',1::bigint)),
  'unknown intent does not reveal a photo');

DO $$ DECLARE first_id uuid; first_path text; response record; n integer; BEGIN
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000001',repeat('f',64),'65000000-0000-4000-8000-000000000001',0::smallint,'image/png',1::bigint);
  PERFORM pg_temp.assert_photo(response.outcome='unverified' AND response.photo_id IS NULL AND response.object_path IS NULL,'wrong proof discloses no photo');
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000001',repeat('a',64),'65000000-0000-4000-8000-000000000001',0::smallint,'image/png',1::bigint);
  first_id := response.photo_id; first_path := response.object_path;
  PERFORM pg_temp.assert_photo(response.outcome='prepared' AND first_id IS NOT NULL
    AND first_path='salon-intents/64000000-0000-4000-8000-000000000001/'||first_id::text||'.png',
    'server-generated immutable path');
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000001',repeat('a',64),'65000000-0000-4000-8000-000000000001',0::smallint,'image/png',1::bigint);
  PERFORM pg_temp.assert_photo(response.outcome='prepared' AND response.photo_id=first_id AND response.object_path=first_path,'same selection reuses identity');
  FOR n IN 1..3 LOOP
    SELECT * INTO response FROM public.prepare_salon_photo(
      '64000000-0000-4000-8000-000000000001',repeat('a',64),'65000000-0000-4000-8000-000000000001',
      CASE WHEN n=1 THEN 1 ELSE 0 END::smallint,CASE WHEN n=2 THEN 'image/jpeg' ELSE 'image/png' END,CASE WHEN n=3 THEN 2 ELSE 1 END::bigint);
    PERFORM pg_temp.assert_photo(response.outcome='conflict' AND response.photo_id IS NULL AND response.object_path IS NULL,'metadata cannot mutate an existing selection');
  END LOOP;
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000002',repeat('b',64),'65000000-0000-4000-8000-000000000001',0::smallint,'image/png',1::bigint);
  PERFORM pg_temp.assert_photo(response.outcome='prepared' AND response.photo_id<>first_id AND response.object_path<>first_path,'same selector on another intent is a distinct object');
  -- Capacity boundaries: the 28th selection is accepted, 29th denied. A retry
  -- of an existing choice still succeeds at the cap without making a new row.
  FOR n IN 2..28 LOOP
    SELECT * INTO response FROM public.prepare_salon_photo(
      '64000000-0000-4000-8000-000000000001',repeat('a',64),
      ('65000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(n%7)::smallint,'image/jpeg',10485760::bigint);
    PERFORM pg_temp.assert_photo(response.outcome='prepared','selection within cap');
  END LOOP;
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000001',repeat('a',64),'65000000-0000-4000-8000-000000000029',0::smallint,'image/png',1::bigint);
  PERFORM pg_temp.assert_photo(response.outcome='limit' AND response.photo_id IS NULL,'new selection exceeds cap');
  SELECT * INTO response FROM public.prepare_salon_photo(
    '64000000-0000-4000-8000-000000000001',repeat('a',64),'65000000-0000-4000-8000-000000000001',0::smallint,'image/png',1::bigint);
  PERFORM pg_temp.assert_photo(response.outcome='prepared' AND response.photo_id=first_id,'retry remains possible at cap');
  PERFORM pg_temp.assert_photo((SELECT count(*)=28 FROM public.salon_submission_photos WHERE intent_id='64000000-0000-4000-8000-000000000001'),'cap and replays preserve count');
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE public.salon_submission_photos SET byte_size=2 WHERE intent_id='64000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'service role mutated photo metadata';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.salon_submission_photos WHERE intent_id='64000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'service role deleted a photo selection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT pg_temp.assert_photo((SELECT outcome='committed' FROM public.commit_salon_submission(
  '64000000-0000-4000-8000-000000000001',repeat('a',64),1::smallint,'proof-hkdf-sha256-v1',repeat('c',64),
  '{"facility_name":"Synthetic photo contract","business_type":"ヘアサロン","representative_name":"Synthetic representative", "contact_name":"Synthetic contact","email":"photo-fixture@example.invalid","phone":"09000000000","features":[],"photo_urls":[],"source":"recruit"}'::jsonb)),
  'commit fixture has a confirmed receipt');
SELECT pg_temp.assert_photo((SELECT outcome='committed' AND photo_id IS NULL AND object_path IS NULL FROM public.prepare_salon_photo(
  '64000000-0000-4000-8000-000000000001',repeat('a',64),gen_random_uuid(),0::smallint,'image/png',1::bigint)),
  'committed intent cannot prepare more uploads');

DO $$ DECLARE response record; bad record; BEGIN
  FOR bad IN SELECT * FROM (VALUES
    (NULL::uuid,0::smallint,'image/png',1::bigint),
    (gen_random_uuid(),NULL::smallint,'image/png',1::bigint),
    (gen_random_uuid(),(-1)::smallint,'image/png',1::bigint),
    (gen_random_uuid(),7::smallint,'image/png',1::bigint),
    (gen_random_uuid(),0::smallint,NULL::text,1::bigint),
    (gen_random_uuid(),0::smallint,'image/svg+xml',1::bigint),
    (gen_random_uuid(),0::smallint,'image/png',NULL::bigint),
    (gen_random_uuid(),0::smallint,'image/png',0::bigint),
    (gen_random_uuid(),0::smallint,'image/png',10485761::bigint)
  ) AS invalid(selection_id,slot,mime_type,byte_size) LOOP
    SELECT * INTO response FROM public.prepare_salon_photo(
      '64000000-0000-4000-8000-000000000002',repeat('b',64),bad.selection_id,bad.slot,bad.mime_type,bad.byte_size);
    PERFORM pg_temp.assert_photo(response.outcome='invalid' AND response.photo_id IS NULL,'invalid input is rejected');
  END LOOP;
  PERFORM pg_temp.assert_photo((SELECT count(*)=1 FROM public.salon_submission_photos WHERE intent_id='64000000-0000-4000-8000-000000000002'),'invalid input creates no manifest');
END $$;
UPDATE public.salon_submission_intents SET created_at=now()-interval '2 days',prepare_expires_at=now()-interval '1 day'
  WHERE id='64000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_photo((SELECT outcome='expired' AND photo_id IS NULL FROM public.prepare_salon_photo(
  '64000000-0000-4000-8000-000000000002',repeat('b',64),gen_random_uuid(),0::smallint,'image/png',1::bigint)), 'preparation expiry prevents further signing');
UPDATE public.salon_submission_intents SET created_at=now()-interval '4 days'
  WHERE id='64000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_photo((SELECT outcome='unverified' AND photo_id IS NULL FROM public.prepare_salon_photo(
  '64000000-0000-4000-8000-000000000002',repeat('b',64),gen_random_uuid(),0::smallint,'image/png',1::bigint)), 'capability expiry checked before prepare expiry');
UPDATE public.salon_submission_intents SET created_at=now()+interval '1 day',prepare_expires_at=now()+interval '2 days'
  WHERE id='64000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_photo((SELECT outcome='unverified' AND photo_id IS NULL FROM public.prepare_salon_photo(
  '64000000-0000-4000-8000-000000000002',repeat('b',64),gen_random_uuid(),0::smallint,'image/png',1::bigint)), 'future issue time cannot prepare uploads');
RESET ROLE;

ROLLBACK;
\echo 'photo manifest fixtures passed (synthetic transaction rolled back; Storage API not tested here)'
