-- Profile photos (bucket avatars) must not be enumerable, and members can remove their own
-- previous photo (2026-10-23).
--
-- 【穴】20260420000011 created
--     CREATE POLICY "Public read avatars" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'avatars');
--   and no later migration dropped it. The bucket is public, so photos load through
--   /storage/v1/object/public/avatars/... (and /render/image/public/...), which do not consult
--   storage.objects policies; this anon SELECT policy only added the ability to LIST the bucket
--   through the Storage API with the anon key. Object names were <account id>/avatar.<ext>, so the
--   listing handed out every member's account id (hidden from the browser everywhere else since
--   20261023110200) together with a URL of their face photo. Same shape as carelink-uploads, fixed by
--   20261021090000.
--
-- 【対処】
--   1. DROP "Public read avatars". Display is unchanged (public URLs). Members keep reading their own
--      folder through avatars_select_own_live (20261008104929), which the Storage API needs for
--      uploads. The application never lists this bucket (no .list() call exists).
--   2. Refuse to finish if any other anon / public / authenticated SELECT or ALL policy that mentions
--      the avatars bucket remains (production once had hand-made storage policies under other names,
--      see 20260628000002). Such a policy must be reconciled by hand, not silently kept.
--   3. avatars_delete_own (new): a live member may delete objects in their own folder only, with the
--      same predicate as avatars_insert_own / avatars_update_own. The profile page now saves each new
--      photo under a random object name (src/lib/avatar-upload.ts) instead of overwriting the
--      guessable avatar.<ext>, and removes the previous photo in the member's own folder after the
--      profile points at the new one. Existing avatars are not moved or renamed: they keep loading
--      from their current URL until the member changes the photo.
--
-- Apply order: after every migration up to 20261023190000. Safe before or after deploying the
-- application: neither the old nor the new page lists the bucket, and public URLs do not use
-- storage.objects policies. Before this migration the new page's removal of the previous photo is
-- refused by RLS and ignored (best effort), leaving the old object in place as before.
-- Verified in a disposable DB by supabase/shadow/avatars-no-anon-listing-fixtures.sql.

DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
-- Production also carries these bucket-wide read policies under other names (created outside the
-- migrations; seen on 2026-10-23 with pg_policies). Both buckets are public, so displayed images are
-- served from the public object URL and never needed them; they only made the whole bucket listable.
DROP POLICY IF EXISTS avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS review_photos_public_read ON storage.objects;
-- The repository's own bucket-wide read policy for review photos (20260420000011, same shape as
-- "Public read avatars"). Production carries it under the name above instead, so this is a no-op
-- there; a database built from the migrations would otherwise stop at the check below.
DROP POLICY IF EXISTS "Public read review-photos" ON storage.objects;

DO $reconcile$
DECLARE leftover text;
BEGIN
  SELECT string_agg(p.policyname::text, ', ' ORDER BY p.policyname) INTO leftover
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND p.cmd IN ('SELECT', 'ALL')
    AND p.roles && ARRAY['anon', 'public', 'authenticated']::name[]
    AND (coalesce(p.qual, '') LIKE '%''avatars''%' OR coalesce(p.qual, '') LIKE '%''review-photos''%')
    AND p.policyname NOT IN ('avatars_select_own_live', 'review_photos_select_own_live');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'avatars/review-photos listing policy requires reconciliation: %', leftover;
  END IF;
END
$reconcile$;

DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
CREATE POLICY avatars_delete_own ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
