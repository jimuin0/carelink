-- Forward validation for the already-recorded signed-upload cutover.
-- The three unrelated write policies are approved complete definitions, not
-- names alone. Unknown INSERT/ALL policies, including broad predicates with
-- no carelink-uploads literal, require explicit reconciliation.
BEGIN;
-- BEGIN SALON STORAGE WRITE POLICY VALIDATION
SET LOCAL search_path = pg_catalog, public;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname='storage' AND p.tablename='objects' AND p.cmd IN ('INSERT','ALL')
      AND (p.policyname::text, md5(jsonb_build_object('cmd',p.cmd,'roles',p.roles,
        'permissive',p.permissive,'qual',p.qual,'with_check',p.with_check)::text)) NOT IN (VALUES
        ('avatars_insert_own','40f02543f6d20cf0378cd7eb4660f516'),
        ('photos_insert_facility_admin','f7eae05269a094acdd8dffcaaff837a4'),
        ('review_photos_insert_scoped','7abdf6a016a5a17dbb7a04a078dcf574'),
        ('Allow anonymous upload','8e1ec33cb9971e09e577ba0c75dedaea'),
        ('Allow anonymous upload images only','e5b0a21ba19b783f6c7a18aef1271af0'),
        ('Allow anonymous upload images only','9a05c051cc90611a40d643435676d4ae'))
  ) THEN RAISE EXCEPTION 'registration write policy set requires reconciliation'; END IF;
END $$;
-- END SALON STORAGE WRITE POLICY VALIDATION
-- Validation precedes the idempotent closure in this same transaction.
DROP POLICY IF EXISTS "Allow anonymous upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous upload images only" ON storage.objects;
COMMIT;
