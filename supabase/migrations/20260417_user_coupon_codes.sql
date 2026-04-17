-- ユーザー個別クーポンコード（v8.25）
-- RFM分析の離脱リスク顧客への自動クーポン送信に使用

CREATE TABLE IF NOT EXISTS user_coupon_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed', 'percentage')),
  discount_value INT NOT NULL,
  reason TEXT,  -- 'at_risk', 'birthday', 'manual' etc.
  valid_until DATE NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_coupon_codes_facility ON user_coupon_codes(facility_id);
CREATE INDEX IF NOT EXISTS idx_user_coupon_codes_email ON user_coupon_codes(email);
CREATE INDEX IF NOT EXISTS idx_user_coupon_codes_code ON user_coupon_codes(code);

ALTER TABLE user_coupon_codes ENABLE ROW LEVEL SECURITY;

-- 匿名でもコード検証可（予約時の照合のため）
CREATE POLICY "anon_read_code" ON user_coupon_codes FOR SELECT USING (true);
