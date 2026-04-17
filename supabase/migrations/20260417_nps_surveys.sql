-- NPS（顧客推奨度）調査
CREATE TABLE IF NOT EXISTS nps_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  category TEXT, -- 'facility', 'platform', 'overall'
  ip_hash TEXT, -- プライバシー保護のためハッシュ化
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;

-- 本人は自分のスコアを挿入・参照可能
CREATE POLICY "nps_own_insert" ON nps_surveys FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "nps_own_select" ON nps_surveys FOR SELECT USING (user_id = auth.uid());

-- 施設管理者は自施設のNPSを参照可能
CREATE POLICY "nps_admin_read" ON nps_surveys FOR SELECT USING (
  facility_id IN (
    SELECT facility_id FROM facility_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  )
);

-- 1ユーザー＋1施設＋1ヶ月で1回まで（重複防止）
CREATE UNIQUE INDEX IF NOT EXISTS idx_nps_unique_monthly
  ON nps_surveys (user_id, facility_id, date_trunc('month', created_at))
  WHERE user_id IS NOT NULL AND facility_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nps_facility ON nps_surveys(facility_id);
CREATE INDEX IF NOT EXISTS idx_nps_booking ON nps_surveys(booking_id);
