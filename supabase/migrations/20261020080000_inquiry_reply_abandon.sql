-- Let an operator close an outbound inquiry reply whose provider outcome stayed
-- unknown past the provider idempotency window, after confirming in the Resend
-- log that no message carries this operation tag. Without this, the partial
-- unique index keeps that contact permanently unable to receive any reply.
--
-- Safety rules enforced here (not only in the API):
--   * only an external, unsent, unaccepted reservation can be abandoned;
--   * only once at least 24 hours after the reservation (Resend keeps an
--     idempotency key for 24 hours, the API stops same-ID retries at 23);
--   * the abandonment time is the database clock, never a client value;
--   * an abandoned reservation can never later become sent or accepted;
--   * no existing row is reclassified by this migration.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.contact_replies') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

ALTER TABLE public.contact_replies
  ADD COLUMN IF NOT EXISTS delivery_abandoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_abandoned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Build the replacement before dropping the old index so there is no instant
-- without the one-pending-reply guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_replies_one_open_external
  ON public.contact_replies(contact_id)
  WHERE is_internal = false AND sent_at IS NULL AND delivery_abandoned_at IS NULL;
DROP INDEX IF EXISTS public.idx_contact_replies_one_pending_external;

CREATE OR REPLACE FUNCTION public.guard_contact_reply_delivery()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.delivery_abandoned_at IS NOT NULL OR NEW.delivery_abandoned_by IS NOT NULL) THEN
    RAISE EXCEPTION 'a reply cannot be created abandoned' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_internal = false THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
      OR NEW.body IS DISTINCT FROM OLD.body OR NEW.is_internal IS DISTINCT FROM OLD.is_internal
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.delivery_envelope IS DISTINCT FROM OLD.delivery_envelope
      OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
      OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id)
      OR (OLD.delivery_abandoned_at IS NOT NULL AND (
        NEW.delivery_abandoned_at IS DISTINCT FROM OLD.delivery_abandoned_at
        OR NEW.delivery_abandoned_by IS DISTINCT FROM OLD.delivery_abandoned_by
        OR NEW.sent_at IS NOT NULL OR NEW.provider_message_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'outbound reply identity and confirmed delivery are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.delivery_abandoned_at IS NULL AND NEW.delivery_abandoned_at IS NOT NULL THEN
      IF NEW.sent_at IS NOT NULL OR NEW.provider_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'an accepted reply cannot be abandoned' USING ERRCODE = '23514';
      END IF;
      IF now() < OLD.created_at + interval '24 hours' THEN
        RAISE EXCEPTION 'reply is still inside the provider idempotency window' USING ERRCODE = '23514';
      END IF;
      NEW.delivery_abandoned_at := now();
    ELSIF OLD.delivery_abandoned_at IS NULL AND NEW.delivery_abandoned_by IS DISTINCT FROM OLD.delivery_abandoned_by THEN
      RAISE EXCEPTION 'abandonment actor requires abandonment' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND (NEW.delivery_abandoned_at IS DISTINCT FROM OLD.delivery_abandoned_at
    OR NEW.delivery_abandoned_by IS DISTINCT FROM OLD.delivery_abandoned_by) THEN
    RAISE EXCEPTION 'only external replies can be abandoned' USING ERRCODE = '23514';
  END IF;
  IF NEW.provider_message_id IS NOT NULL AND (NEW.is_internal OR NEW.sent_at IS NULL OR NEW.delivery_envelope IS NULL) THEN
    RAISE EXCEPTION 'provider acceptance requires an external reply and reserved envelope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_contact_reply_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_reply_delivery() TO service_role;
