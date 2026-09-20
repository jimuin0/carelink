-- Ensure fresh Supabase environments can complete self-service salon registration.
-- Existing production bucket settings are intentionally preserved; the historical
-- migration 20260628000002 applies the MIME allowlist when the bucket already exists.
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
ON CONFLICT (id) DO NOTHING;
