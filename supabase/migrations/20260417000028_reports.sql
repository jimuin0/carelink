-- 通報テーブル（v8.14）
-- レビュー・施設の不正報告を管理

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reporter_ip TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('review', 'facility', 'photo')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'fake', 'offensive', 'other')),
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- 同一IPからの重複通報防止（24h以内の同一対象への通報は1件のみ）
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_ip_target_day
  -- created_at は timestamptz のため date_trunc(text, timestamptz) は STABLE 扱いで
  -- index 式に使えない（42P17: functions in index expression must be marked IMMUTABLE）。
  -- AT TIME ZONE 'UTC' で timestamp(without tz) に固定変換すると date_trunc が IMMUTABLE になる。
  -- UTC 日境界での一意性（同一IP・同一対象・同一日に1件）として決定的に機能する。
  ON reports(reporter_ip, target_type, target_id, date_trunc('day', (created_at AT TIME ZONE 'UTC')))
  WHERE reporter_ip IS NOT NULL;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分の通報のみ作成可
CREATE POLICY "user_insert_report" ON reports FOR INSERT
  WITH CHECK (
    reporter_user_id = auth.uid() OR reporter_user_id IS NULL
  );

-- 管理者は全件参照・更新可
CREATE POLICY "admin_all_reports" ON reports FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
