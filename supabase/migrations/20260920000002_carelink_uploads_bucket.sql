-- Ensure self-service salon registration has an image-only public upload bucket.
-- Production drift showed the historical bucket update and restrictive anonymous
-- upload policy were not consistently applied. Reconcile the effective settings
-- without changing the bucket's existing public visibility.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'carelink-uploads',
  'carelink-uploads',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS policies are permissive by default, so every anon INSERT policy must be
-- constrained. Fresh replay already has the image-only policy from the historical
-- migration; production may still have the legacy broad policy. Tighten either
-- known policy in place, then remove the legacy duplicate if both exist.
DO $migration$
DECLARE
  has_legacy boolean;
  has_image_only boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polname = 'Allow anonymous upload'
  ) INTO has_legacy;

  SELECT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polname = 'Allow anonymous upload images only'
  ) INTO has_image_only;

  IF has_image_only THEN
    ALTER POLICY "Allow anonymous upload images only" ON storage.objects
      WITH CHECK (
        bucket_id = 'carelink-uploads'
        AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
      );
  ELSIF has_legacy THEN
    ALTER POLICY "Allow anonymous upload" ON storage.objects
      WITH CHECK (
        bucket_id = 'carelink-uploads'
        AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
      );
    ALTER POLICY "Allow anonymous upload" ON storage.objects
      RENAME TO "Allow anonymous upload images only";
  ELSE
    RAISE EXCEPTION '既知のCareLink匿名アップロードポリシーがありません。接続先とmigration履歴を確認してください。';
  END IF;

  IF has_legacy AND has_image_only THEN
    DROP POLICY "Allow anonymous upload" ON storage.objects;
  END IF;
END;
$migration$;
