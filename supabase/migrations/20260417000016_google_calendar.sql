-- Googleカレンダー同期
-- ユーザーのGoogle OAuth トークンとカレンダーイベントIDを管理

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 予約↔カレンダーイベントの対応テーブル
CREATE TABLE IF NOT EXISTS booking_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_tokens_user ON google_calendar_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_cal_events_booking ON booking_calendar_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cal_events_user ON booking_calendar_events(user_id);

ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gcal_tokens_own" ON google_calendar_tokens
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "booking_cal_events_own" ON booking_calendar_events
  FOR ALL USING (user_id = auth.uid());
