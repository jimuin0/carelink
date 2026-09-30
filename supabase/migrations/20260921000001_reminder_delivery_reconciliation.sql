-- Apply before the corresponding cron deployment. Existing claims remain legacy and are never resent.
-- Rollback: stop booking-reminder first, revert application, retain this additive schema and all claims.
-- Do not drop delivery_state while delivering/uncertain claims exist: that would lose reconciliation evidence.
BEGIN;

ALTER TABLE public.sent_reminders
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.sent_reminders
  ADD CONSTRAINT sent_reminders_delivery_state_check
  CHECK (delivery_state IN ('legacy', 'claimed', 'delivering', 'delivered', 'closed', 'uncertain'));
CREATE INDEX sent_reminders_unresolved_idx ON public.sent_reminders (delivery_state, sent_at)
  WHERE delivery_state IN ('claimed', 'delivering', 'uncertain');
-- Existing restrictive RLS remains unchanged: only the service role can read/write delivery claims.

-- Empty recipients are not eligible: match the route's truthy checks before its batch limit.
-- Filter already claimed slots BEFORE applying the batch limit. Each successful batch frees capacity
-- for the next one; a fixed prefix of previously sent bookings can no longer starve later bookings.
CREATE OR REPLACE FUNCTION public.pending_booking_reminders(p_today date)
RETURNS SETOF public.bookings
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT b.*
  FROM public.bookings b
  LEFT JOIN public.facility_reminder_settings s ON s.facility_id = b.facility_id
  LEFT JOIN public.profiles p ON p.id = b.user_id
  WHERE b.status = 'confirmed'
    AND b.booking_date IN (p_today + 1, p_today + 3, p_today + 7)
    AND EXISTS (
      SELECT 1 FROM (VALUES
        ('email_1d', b.booking_date = p_today + 1 AND b.email IS NOT NULL AND b.email <> ''),
        ('email_7d', b.booking_date = p_today + 7 AND b.email IS NOT NULL AND b.email <> '' AND s.remind_7d_email),
        ('email_3d', b.booking_date = p_today + 3 AND b.email IS NOT NULL AND b.email <> '' AND s.remind_3d_email
          AND EXISTS (SELECT 1 FROM public.facility_entitlements e WHERE e.facility_id = b.facility_id AND e.option_key = 'reminder_email_3d' AND e.status = 'active')),
        ('line_3d', b.booking_date = p_today + 3 AND p.line_user_id IS NOT NULL AND p.line_user_id <> '' AND s.remind_3d_line
          AND EXISTS (SELECT 1 FROM public.facility_entitlements e WHERE e.facility_id = b.facility_id AND e.option_key = 'reminder_line' AND e.status = 'active')),
        ('line_7d', b.booking_date = p_today + 7 AND p.line_user_id IS NOT NULL AND p.line_user_id <> '' AND s.remind_7d_line
          AND EXISTS (SELECT 1 FROM public.facility_entitlements e WHERE e.facility_id = b.facility_id AND e.option_key = 'reminder_line' AND e.status = 'active'))
      ) AS candidate(kind, enabled)
      WHERE candidate.enabled
        AND NOT EXISTS (
          SELECT 1 FROM public.sent_reminders r
          WHERE r.booking_id = b.id AND r.reminder_date = b.booking_date AND r.kind = candidate.kind
        )
    );
$$;
REVOKE ALL ON FUNCTION public.pending_booking_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_booking_reminders(date) TO service_role;
COMMIT;
