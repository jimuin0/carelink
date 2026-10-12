-- Preserve historical scheduled campaigns, but never create or restore a new
-- scheduled state. No delivery is started and no existing row is rewritten.
ALTER TABLE public.newsletter_campaigns ADD CONSTRAINT newsletter_manual_only
  CHECK(status <> 'scheduled') NOT VALID;
