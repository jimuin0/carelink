-- 広告枠: 検索結果上位表示の有料オプション
-- 施設が入札または固定料金で上位表示を購入

CREATE TABLE IF NOT EXISTS featured_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  slot_type TEXT NOT NULL CHECK (slot_type IN ('search_top', 'area_banner', 'category_top')),
  area TEXT,           -- 対象エリア（NULL = 全国）
  business_type TEXT,  -- 対象業種（NULL = 全業種）
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  budget_yen INT NOT NULL DEFAULT 0,         -- 予算（円/月）
  impressions INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_featured_slots_active ON featured_slots(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_featured_slots_area ON featured_slots(area, business_type);
CREATE INDEX IF NOT EXISTS idx_featured_slots_facility ON featured_slots(facility_id);

ALTER TABLE featured_slots ENABLE ROW LEVEL SECURITY;

-- オーナーは自分の施設の広告のみ閲覧・作成
CREATE POLICY "featured_slots_owner" ON featured_slots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE facility_id = featured_slots.facility_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- プラットフォーム管理者は全件
CREATE POLICY "featured_slots_platform_admin" ON featured_slots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_platform_admin = TRUE
    )
  );

-- 公開用: アクティブな広告枠は誰でも読める（検索表示用）
CREATE POLICY "featured_slots_public_read" ON featured_slots
  FOR SELECT USING (
    is_active = TRUE
    AND starts_at <= NOW()
    AND ends_at >= NOW()
  );
