-- Idempotency table for booking-reminder cron
-- Prevents duplicate emails when Vercel fires the cron more than once per day.
CREATE TABLE IF NOT EXISTS sent_reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_date DATE NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sent_reminders_booking_date_uniq UNIQUE (booking_id, reminder_date)
);

-- No need for RLS — only service role writes to this table via the cron.
ALTER TABLE sent_reminders ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon/authenticated; service role bypasses RLS.
CREATE POLICY "no_access" ON sent_reminders AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

CREATE INDEX IF NOT EXISTS sent_reminders_reminder_date_idx ON sent_reminders (reminder_date);
