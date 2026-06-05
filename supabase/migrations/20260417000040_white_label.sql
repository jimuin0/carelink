-- ホワイトラベル: 施設独自ドメインで予約ページ提供
-- 施設が独自ドメインを設定すると、そのドメインからもアクセス可能に

CREATE TABLE IF NOT EXISTS white_label_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,            -- 例: booking.myacupuncture.com
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  txt_record TEXT,                 -- DNS TXTレコード認証用
  logo_url TEXT,                   -- カスタムロゴURL
  primary_color TEXT DEFAULT '#0ea5e9',  -- ブランドカラー
  brand_name TEXT,                 -- ブランド名（CareLink以外の表示名）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain)
);

CREATE INDEX IF NOT EXISTS idx_white_label_domains_facility ON white_label_domains(facility_id);
CREATE INDEX IF NOT EXISTS idx_white_label_domains_domain ON white_label_domains(domain);

ALTER TABLE white_label_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "white_label_domains_owner" ON white_label_domains
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE facility_id = white_label_domains.facility_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "white_label_domains_platform_admin" ON white_label_domains
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_platform_admin = TRUE
    )
  );
