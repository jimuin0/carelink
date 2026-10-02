-- Read-only evidence collection, NOT a migration or an approval to cut over.
-- No object names, owners, metadata, customer rows, or credentials are returned.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT current_setting('server_version') AS server_version;
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'carelink-uploads';

-- Review ALL policies: a differently named permissive INSERT/ALL policy may
-- keep anonymous/authenticated uploads open after the two historical drops.
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid = 'storage.objects'::regclass;

-- Versions only: compare the complete ledger to the reviewed local batch.
-- Never emit schema_migrations.statements or repair an unexplained gap.
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

-- Counts are observations, NOT proof that old browser forms have drained.
SELECT count(*) AS object_count,
  count(*) FILTER (WHERE name LIKE 'salons/%') AS legacy_object_count,
  count(*) FILTER (WHERE name LIKE 'salon-intents/%') AS signed_object_count
FROM storage.objects WHERE bucket_id = 'carelink-uploads';

ROLLBACK;
