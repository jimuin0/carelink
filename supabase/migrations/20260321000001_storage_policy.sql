-- Allow anonymous uploads to carelink-uploads bucket (for salon photo uploads)
-- Using storage.objects table policies

-- Allow anonymous INSERT (upload)
CREATE POLICY "Allow anonymous upload" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'carelink-uploads');

-- Allow public read of uploaded files
CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'carelink-uploads');
