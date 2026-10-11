-- Backward-compatible capacity phase. Anonymous V1 INSERT is deliberately
-- preserved until the separately approved signed-only contract phase.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='carelink-uploads'
    AND allowed_mime_types IS NOT NULL
    AND NOT (allowed_mime_types && ARRAY['image/jpeg','image/png','image/webp','image/gif'])) THEN
    RAISE EXCEPTION 'REGISTRATION_BUCKET_MIME_RECONCILIATION_REQUIRED';
  END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('carelink-uploads','carelink-uploads',true,10485760,ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT(id) DO UPDATE SET
  file_size_limit=LEAST(COALESCE(storage.buckets.file_size_limit,10485760),10485760),
  allowed_mime_types=CASE WHEN storage.buckets.allowed_mime_types IS NULL
    THEN ARRAY['image/jpeg','image/png','image/webp','image/gif']
    ELSE ARRAY(SELECT m FROM unnest(storage.buckets.allowed_mime_types) m
      WHERE m IN ('image/jpeg','image/png','image/webp','image/gif')) END;

-- The old permissive review INSERT made the scoped policy ineffective: RLS
-- permissive policies are ORed. Remove that named bypass without touching V1.
DROP POLICY IF EXISTS review_photos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload review-photos" ON storage.objects;
DROP POLICY IF EXISTS review_photos_insert_scoped ON storage.objects;
CREATE POLICY review_photos_insert_scoped ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='review-photos' AND (storage.foldername(name))[1]='reviews'
  AND (storage.foldername(name))[2] IN (SELECT f.id::text FROM public.facility_profiles f)
  AND storage.extension(name) IN ('jpg','jpeg','png','webp')
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
DROP POLICY IF EXISTS review_photos_delete_own ON storage.objects;
CREATE POLICY review_photos_delete_own ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='review-photos' AND owner_id=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
DROP POLICY IF EXISTS review_photos_select_own_live ON storage.objects;
CREATE POLICY review_photos_select_own_live ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='review-photos' AND owner_id=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));

-- A deleted account's still-unexpired JWT must not recreate/update avatars
-- using only its old sub. No broader Auth schema access or new RPC is added.
DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
CREATE POLICY avatars_insert_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
-- UPDATE and the Storage API's object verification require SELECT too.
DROP POLICY IF EXISTS avatars_select_own_live ON storage.objects;
CREATE POLICY avatars_select_own_live ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
CREATE POLICY avatars_update_own ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())))
WITH CHECK(bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())));
