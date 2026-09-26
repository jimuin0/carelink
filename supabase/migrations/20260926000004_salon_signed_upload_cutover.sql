-- CONTRACT PHASE, NOT AN ADDITIVE PRE-DEPLOY MIGRATION.
-- Requires deployed signed-upload consumers and an approved cutover plan for
-- open legacy forms. Do not apply by bulk `db push` ahead of that deployment.
-- Keep registration v2 disabled until signed-only Storage and commit/claim
-- consumers are verified. Public schema preparation is in 000001..000003.
BEGIN;

-- BEGIN SALON STORAGE RECONCILIATION
-- Preserve an existing public/private decision and any stricter byte limit.
-- An incompatible out-of-band MIME configuration requires reconciliation.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='carelink-uploads'
    AND allowed_mime_types IS NOT NULL
    AND NOT (allowed_mime_types && ARRAY['image/jpeg','image/png','image/webp','image/gif'])) THEN
    RAISE EXCEPTION 'registration bucket MIME configuration requires reconciliation';
  END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('carelink-uploads','carelink-uploads',true,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit=LEAST(COALESCE(storage.buckets.file_size_limit,10485760),10485760),
  allowed_mime_types=CASE WHEN storage.buckets.allowed_mime_types IS NULL
    THEN ARRAY['image/jpeg','image/png','image/webp','image/gif']
    ELSE ARRAY(SELECT mime FROM unnest(storage.buckets.allowed_mime_types) mime
      WHERE mime IN ('image/jpeg','image/png','image/webp','image/gif')) END;

-- Reconcile the two observed historical names, not unrelated bucket policies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN ('Allow anonymous upload','Allow anonymous upload images only'))
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('Allow anonymous upload','Allow anonymous upload images only')
      AND (roles IS DISTINCT FROM ARRAY['anon']::name[] OR cmd <> 'INSERT' OR permissive <> 'PERMISSIVE')) THEN
    RAISE EXCEPTION 'registration upload policy requires reconciliation';
  END IF;
END $$;
DROP POLICY IF EXISTS "Allow anonymous upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous upload images only" ON storage.objects;
-- Both public roles use server-issued immutable capabilities. No direct
-- INSERT bypass remains for the historical salons/ prefix or the v2 prefix.
-- END SALON STORAGE RECONCILIATION

COMMIT;
