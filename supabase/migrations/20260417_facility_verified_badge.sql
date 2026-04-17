-- 施設認証バッジ（v8.31）
-- facility_profiles に is_verified / verified_type / verified_at を追加
-- 管理者が手動で認証ステータスを付与する

ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_type        TEXT CHECK (verified_type IN ('phone', 'identity', 'site_visit')),
  ADD COLUMN IF NOT EXISTS verified_at          TIMESTAMPTZ;

-- 認証済み施設の検索用インデックス
CREATE INDEX IF NOT EXISTS idx_facility_profiles_verified
  ON facility_profiles (is_verified)
  WHERE is_verified = TRUE;

-- facility_card_view への verified フラグ追加
-- NOTE: マテリアライズドビューは DROP & RECREATE が必要なため、
-- アプリ側では facility_profiles から直接 is_verified を取得する
-- （施設詳細ページは既に full facility record を SELECT している）

COMMENT ON COLUMN facility_profiles.is_verified IS '施設認証バッジ: 電話確認・本人確認・現地訪問のいずれかで確認済み';
COMMENT ON COLUMN facility_profiles.verified_type IS '認証種別: phone=電話確認, identity=本人確認書類, site_visit=現地訪問確認';
COMMENT ON COLUMN facility_profiles.verified_at IS '認証付与日時';
