-- ダッシュボード強化テーブル（v8.1）

-- 売上日次サマリ（cronバッチで集計）
CREATE TABLE IF NOT EXISTS daily_revenue_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_revenue INT DEFAULT 0,
  booking_count INT DEFAULT 0,
  completed_count INT DEFAULT 0,
  cancelled_count INT DEFAULT 0,
  no_show_count INT DEFAULT 0,
  new_customer_count INT DEFAULT 0,
  repeat_customer_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, date)
);

ALTER TABLE daily_revenue_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Facility members can view" ON daily_revenue_summary
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = daily_revenue_summary.facility_id
      AND facility_members.user_id = auth.uid()
  ));

-- 顧客セグメント（RFM分析用）
CREATE TABLE IF NOT EXISTS customer_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  first_visit_date DATE,
  last_visit_date DATE,
  total_visits INT DEFAULT 0,
  total_spent INT DEFAULT 0,
  segment TEXT CHECK (segment IN ('vip', 'regular', 'at_risk', 'lost', 'new')),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, customer_email)
);

ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Facility members can view" ON customer_segments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = customer_segments.facility_id
      AND facility_members.user_id = auth.uid()
  ));

-- 通知設定（施設オーナー向け）
CREATE TABLE IF NOT EXISTS facility_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL UNIQUE REFERENCES facility_profiles(id) ON DELETE CASCADE,
  push_on_new_booking BOOLEAN DEFAULT true,
  push_on_cancel BOOLEAN DEFAULT true,
  push_on_review BOOLEAN DEFAULT true,
  email_daily_summary BOOLEAN DEFAULT false,
  email_weekly_report BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE facility_notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Facility members can manage" ON facility_notification_settings
  FOR ALL USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = facility_notification_settings.facility_id
      AND facility_members.user_id = auth.uid()
      AND facility_members.role IN ('owner', 'admin')
  ));

-- インデックス
CREATE INDEX IF NOT EXISTS idx_daily_revenue_facility_date ON daily_revenue_summary(facility_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_segments_facility ON customer_segments(facility_id);
CREATE INDEX IF NOT EXISTS idx_customer_segments_segment ON customer_segments(facility_id, segment);
