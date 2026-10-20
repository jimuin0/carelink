-- Account deletion must not be blocked by an abandoned inquiry reply.
-- delivery_abandoned_by references auth.users ON DELETE SET NULL, but the guard
-- from 20261020080000 rejected every change to the actor of an abandoned reply,
-- so deleting the operator's account rolled back with 23514. Allow only the
-- clearing of the actor; the abandonment time and every other field stay fixed.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.contact_replies') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

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
        -- The actor may only be cleared, which is what ON DELETE SET NULL does when
        -- that operator's account is deleted. Any other change stays forbidden.
        OR (NEW.delivery_abandoned_by IS DISTINCT FROM OLD.delivery_abandoned_by AND NEW.delivery_abandoned_by IS NOT NULL)
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
