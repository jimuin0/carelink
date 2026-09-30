-- DEFERRED CONTRACT PHASE, NOT AN ACTIVE MIGRATION.
-- This file is intentionally outside supabase/migrations. It removes the
-- anonymous Storage upload path used by the current V1 browser flow.
-- Promote it to a new active migration only after the V2 signed-upload
-- consumer is deployed and enabled, legacy V1 forms are drained or otherwise
-- safely handled, and the production preflight/history gate is satisfied.
-- See supabase/deferred-migrations/README.md. Never apply it from SQL Editor.
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
    ELSE ARRAY(SELECT allowed_mime.mime
      FROM unnest(storage.buckets.allowed_mime_types) AS allowed_mime(mime)
      WHERE allowed_mime.mime IN ('image/jpeg','image/png','image/webp','image/gif')) END;

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
