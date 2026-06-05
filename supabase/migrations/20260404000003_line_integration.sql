-- LINE連携テーブル（v8.0）
-- CareLink ↔ LINE アカウント連携、通知設定、ログ

BEGIN;

-- ユーザーのLINE連携情報
CREATE TABLE IF NOT EXISTS line_user_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  picture_url TEXT,
  linked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE line_user_links ENABLE ROW LEVEL SECURITY;
-- user_idがNULL（フォローのみ、未連携）の行はRLS経由では見えない。service_roleで管理
CREATE POLICY "Users can read own link" ON line_user_links FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own link" ON line_user_links FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own link" ON line_user_links FOR DELETE USING (auth.uid() = user_id);

-- LINE通知設定（施設単位）
CREATE TABLE IF NOT EXISTS facility_line_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL UNIQUE REFERENCES facility_profiles(id) ON DELETE CASCADE,
  notify_on_booking BOOLEAN DEFAULT true,
  notify_on_cancel BOOLEAN DEFAULT true,
  reminder_enabled BOOLEAN DEFAULT true,
  reminder_hours_before INT DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE facility_line_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Facility members can manage" ON facility_line_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE facility_members.facility_id = facility_line_settings.facility_id
        AND facility_members.user_id = auth.uid()
        AND facility_members.role IN ('owner', 'admin')
    )
  );

-- LINE通知ログ
CREATE TABLE IF NOT EXISTS line_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('booking_confirm', 'reminder', 'cancel', 'status_change')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE line_notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Facility members can view logs" ON line_notification_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN facility_members fm ON fm.facility_id = b.facility_id
      WHERE b.id = line_notification_logs.booking_id
        AND fm.user_id = auth.uid()
    )
  );

-- インデックス
CREATE INDEX IF NOT EXISTS idx_line_user_links_user_id ON line_user_links(user_id);
CREATE INDEX IF NOT EXISTS idx_line_user_links_line_user_id ON line_user_links(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_notification_logs_booking ON line_notification_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_line_notification_logs_created ON line_notification_logs(created_at DESC);

COMMIT;
