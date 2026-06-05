-- Security: restrict carelink-uploads bucket to safe image extensions only.
-- Client-side validation (ACCEPTED_TYPES) can be bypassed via direct API calls.
-- This enforces the restriction at the Supabase Storage RLS level.
-- Note: SVG is intentionally excluded — SVG can contain embedded <script> tags.

DROP POLICY IF EXISTS "Allow anonymous upload" ON storage.objects;

CREATE POLICY "Allow anonymous upload images only" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'carelink-uploads'
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  );

-- Authenticated upload to photos bucket: restrict to image extensions
-- (admin facility photo uploads — browser client uses authenticated session)
-- NOTE: `CREATE POLICY IF NOT EXISTS` は未対応構文（42601）。各ポリシーを DROP+CREATE で冪等化。
DROP POLICY IF EXISTS "Allow authenticated upload photos" ON storage.objects;
CREATE POLICY "Allow authenticated upload photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp')
  );

-- Authenticated upload to avatars bucket: restrict to image extensions
DROP POLICY IF EXISTS "Allow authenticated upload avatars" ON storage.objects;
CREATE POLICY "Allow authenticated upload avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp')
  );

-- Authenticated upload to review-photos bucket: restrict to image extensions
DROP POLICY IF EXISTS "Allow authenticated upload review-photos" ON storage.objects;
CREATE POLICY "Allow authenticated upload review-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-photos'
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp')
  );

-- Public read for photos and avatars
DROP POLICY IF EXISTS "Public read photos" ON storage.objects;
CREATE POLICY "Public read photos" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "Public read avatars" ON storage.objects;
CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public read review-photos" ON storage.objects;
CREATE POLICY "Public read review-photos" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'review-photos');
