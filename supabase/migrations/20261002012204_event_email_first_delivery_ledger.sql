-- M06. A provider acceptance is evidence, not proof of inbox delivery.
-- Existing messages are not reset or resent by this migration.
ALTER TABLE public.webhook_retry_queue
  ADD COLUMN provider_message_id uuid,
  ADD COLUMN email_envelope jsonb;
ALTER TABLE public.webhook_retry_queue ADD CONSTRAINT event_email_envelope_shape CHECK (
  email_envelope IS NULL OR (
    jsonb_typeof(email_envelope) = 'object'
    AND email_envelope ?& ARRAY['from','to','subject','html']
    AND email_envelope - ARRAY['from','to','subject','html'] = '{}'::jsonb
    AND jsonb_typeof(email_envelope->'from') = 'string'
    AND jsonb_typeof(email_envelope->'to') = 'string'
    AND jsonb_typeof(email_envelope->'subject') = 'string'
    AND jsonb_typeof(email_envelope->'html') = 'string'
  )
);
CREATE FUNCTION public.guard_event_email_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.webhook_type = 'manual_booking_confirmation'
    OR (OLD.webhook_type = 'email' AND OLD.payload->>'event_email_version' = '1') THEN
    IF NEW.id <> OLD.id OR NEW.webhook_type <> OLD.webhook_type
      OR NEW.target_id <> OLD.target_id OR NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
      OR (OLD.email_envelope IS NOT NULL AND NEW.email_envelope IS DISTINCT FROM OLD.email_envelope)
      OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id)
      OR (OLD.email_envelope IS NULL AND NEW.email_envelope IS NOT NULL
          AND (OLD.status <> 'processing' OR OLD.delivery_started_at IS NOT NULL))
    THEN RAISE EXCEPTION 'EVENT_EMAIL_IDENTITY_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_event_email_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_event_email_identity BEFORE UPDATE ON public.webhook_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_email_identity();
