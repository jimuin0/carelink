-- Preserve the exact dispatch envelope and provider acceptance evidence.
-- No existing pending reply is reclassified or unlocked by this migration.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.contact_replies
  ADD COLUMN IF NOT EXISTS delivery_envelope jsonb,
  ADD COLUMN IF NOT EXISTS provider_message_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_replies_provider_message
  ON public.contact_replies(provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_contact_reply_delivery()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_internal = false THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
      OR NEW.body IS DISTINCT FROM OLD.body OR NEW.is_internal IS DISTINCT FROM OLD.is_internal
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.delivery_envelope IS DISTINCT FROM OLD.delivery_envelope
      OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
      OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id) THEN
      RAISE EXCEPTION 'outbound reply identity and confirmed delivery are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.provider_message_id IS NOT NULL AND (NEW.is_internal OR NEW.sent_at IS NULL OR NEW.delivery_envelope IS NULL) THEN
    RAISE EXCEPTION 'provider acceptance requires an external reply and reserved envelope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_contact_reply_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_reply_delivery() TO service_role;
DROP TRIGGER IF EXISTS contact_reply_delivery_guard ON public.contact_replies;
CREATE TRIGGER contact_reply_delivery_guard BEFORE INSERT OR UPDATE ON public.contact_replies
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_reply_delivery();
