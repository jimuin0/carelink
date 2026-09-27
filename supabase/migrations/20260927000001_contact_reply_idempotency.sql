-- Serialize unresolved outbound replies per inquiry. The API inserts the reply row
-- before calling Resend and uses the row UUID as the provider idempotency key.
-- Fail closed rather than guessing how to reconcile any pre-existing unresolved rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contact_replies
    WHERE is_internal = false
      AND sent_at IS NULL
    GROUP BY contact_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple unresolved outbound replies exist; reconcile them before applying contact reply idempotency';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_replies_one_pending_external
  ON public.contact_replies (contact_id)
  WHERE is_internal = false AND sent_at IS NULL;
