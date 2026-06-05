-- 回数券・パッケージ機能（v8.41）
-- 施設が回数券を作成し、ユーザーが購入・利用できる仕組み

-- パッケージ定義
CREATE TABLE IF NOT EXISTS service_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  -- FK 先は canonical な facility_menus（`menus` テーブルは本番にも migration にも存在せず、
  --   このまま適用すると 42P01 で失敗する dangling FK だった。他テーブルの menu_id は全て
  --   facility_menus(id) を参照しており、それに統一する root fix）。
  menu_id         UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  session_count   INTEGER NOT NULL DEFAULT 5 CHECK (session_count > 0),
  bonus_count     INTEGER NOT NULL DEFAULT 0 CHECK (bonus_count >= 0),
  price           INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  valid_days      INTEGER NOT NULL DEFAULT 365 CHECK (valid_days > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN service_packages.session_count IS '購入回数（例: 5回）';
COMMENT ON COLUMN service_packages.bonus_count IS 'ボーナス回数（例: 1回無料=1）';
COMMENT ON COLUMN service_packages.valid_days IS '有効期限（日数）';

-- ユーザーが購入した回数券
CREATE TABLE IF NOT EXISTS user_packages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id         UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  package_id          UUID NOT NULL REFERENCES service_packages(id) ON DELETE RESTRICT,
  sessions_total      INTEGER NOT NULL,
  sessions_remaining  INTEGER NOT NULL,
  purchased_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  notes               TEXT,
  CONSTRAINT sessions_remaining_valid CHECK (sessions_remaining >= 0 AND sessions_remaining <= sessions_total)
);

-- 回数券の使用履歴
CREATE TABLE IF NOT EXISTS package_usage_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_package_id UUID NOT NULL REFERENCES user_packages(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_service_packages_facility ON service_packages (facility_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_packages_user ON user_packages (user_id);
CREATE INDEX IF NOT EXISTS idx_user_packages_facility ON user_packages (facility_id);
CREATE INDEX IF NOT EXISTS idx_user_packages_active ON user_packages (user_id, facility_id) WHERE sessions_remaining > 0;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_service_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_packages_updated_at ON service_packages;
CREATE TRIGGER trg_service_packages_updated_at
  BEFORE UPDATE ON service_packages
  FOR EACH ROW EXECUTE FUNCTION update_service_packages_updated_at();

-- RLS
ALTER TABLE service_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_packages_public_read" ON service_packages FOR SELECT USING (is_active = true);
CREATE POLICY "service_packages_admin_all" ON service_packages FOR ALL USING (
  EXISTS (SELECT 1 FROM facility_members WHERE user_id = auth.uid() AND facility_id = service_packages.facility_id AND role IN ('owner', 'admin'))
);

ALTER TABLE user_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_packages_own_read" ON user_packages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_packages_facility_read" ON user_packages FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members WHERE user_id = auth.uid() AND facility_id = user_packages.facility_id AND role IN ('owner', 'admin'))
);
CREATE POLICY "user_packages_facility_insert" ON user_packages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members WHERE user_id = auth.uid() AND facility_id = user_packages.facility_id AND role IN ('owner', 'admin'))
);
CREATE POLICY "user_packages_facility_update" ON user_packages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE user_id = auth.uid() AND facility_id = user_packages.facility_id AND role IN ('owner', 'admin'))
);

ALTER TABLE package_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "package_usage_own_read" ON package_usage_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_packages WHERE id = package_usage_logs.user_package_id AND user_id = auth.uid())
);
CREATE POLICY "package_usage_facility_all" ON package_usage_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM user_packages up
    JOIN facility_members fm ON fm.facility_id = up.facility_id
    WHERE up.id = package_usage_logs.user_package_id AND fm.user_id = auth.uid() AND fm.role IN ('owner', 'admin')
  )
);
