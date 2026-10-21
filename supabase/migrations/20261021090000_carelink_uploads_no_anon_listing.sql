-- Store-registration photos (bucket carelink-uploads) must not be enumerable
-- by anonymous visitors. The bucket is public, so images keep loading through
-- /storage/v1/object/public/... URLs, which do not consult storage.objects
-- policies. The anon SELECT policy from 20260321000002 only added the ability
-- to list every applicant's file names through the Storage API; the
-- application never lists this bucket (no .list() call exists), and uploads
-- now use server-issued signed upload URLs. Decided by the owner on
-- 2026-10-21.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
