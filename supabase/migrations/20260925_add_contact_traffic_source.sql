ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS traffic_source jsonb;
