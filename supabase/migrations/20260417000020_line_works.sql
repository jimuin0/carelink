-- LINE Works channel ID for staff notifications
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS line_works_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS line_works_notify_all BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staff_profiles.line_works_channel_id IS 'LINE Works Bot channel ID for receiving booking notifications';
COMMENT ON COLUMN staff_profiles.line_works_notify_all IS 'Receive notifications for all bookings (not only personally assigned ones)';
