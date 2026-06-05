-- feature flag 基盤（v8.41）
-- 機能の段階的リリース・A/Bテスト・緊急停止スイッチを管理

CREATE TABLE IF NOT EXISTS feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_pct   INTEGER NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  description   TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN feature_flags.rollout_pct IS 'ロールアウト割合（0=無効, 100=全員有効, 50=半数に有効）。ユーザーIDのハッシュで判定。';
COMMENT ON COLUMN feature_flags.metadata IS '追加設定（例: {"allowed_user_ids": ["uuid1","uuid2"]} でホワイトリスト指定）';

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_feature_flags_updated_at();

-- RLS: 全ユーザー読み取り可（フロントエンドで参照するため）、書き込みは管理者のみ
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feature_flags_public_read" ON feature_flags FOR SELECT USING (true);
CREATE POLICY "feature_flags_admin_write" ON feature_flags FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 初期フラグのシード
INSERT INTO feature_flags (key, enabled, rollout_pct, description) VALUES
  ('stripe_checkout',       false, 0,   'Stripe Checkout による事前決済'),
  ('waitlist',              true,  100, 'キャンセル待ち機能'),
  ('intake_forms',          true,  100, '施術前デジタル問診票'),
  ('ai_review_summary',     true,  100, 'AI口コミ要約（Claude Haiku）'),
  ('google_calendar_sync',  false, 0,   'Googleカレンダー同期'),
  ('line_rich_menu',        false, 0,   'LINEリッチメニュー'),
  ('multilingual',          false, 0,   '多言語対応（英語/中国語/韓国語）'),
  ('postis_search',         false, 0,   'PostGIS GPS検索'),
  ('verified_badge',        true,  100, '施設認証バッジ表示'),
  ('recaptcha',             false, 0,   'reCAPTCHA v3（RECAPTCHA_SECRET_KEY設定後に有効化）')
ON CONFLICT (key) DO NOTHING;
