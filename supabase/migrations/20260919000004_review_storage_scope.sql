-- レビュー写真の容量・パス境界をStorage側でも強制する。
-- 本番適用はSupabase SQL Editorで承認済みの固定計画に従って実施すること。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-photos', 'review-photos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Allow authenticated upload review-photos" ON storage.objects;
DROP POLICY IF EXISTS "review_photos_insert_scoped" ON storage.objects;
CREATE POLICY "review_photos_insert_scoped" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = 'reviews'
    AND (storage.foldername(name))[2] IN (SELECT id::text FROM public.facility_profiles)
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp')
  );

DROP POLICY IF EXISTS "review_photos_delete_own" ON storage.objects;
CREATE POLICY "review_photos_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'review-photos'
    AND owner_id = auth.uid()::text
  );
