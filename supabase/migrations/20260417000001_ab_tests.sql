-- A/Bテスト基盤（feature_flagsと連携）
CREATE TABLE IF NOT EXISTS ab_test_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_key TEXT NOT NULL, -- feature_flagsのkey
  variant TEXT NOT NULL CHECK (variant IN ('control', 'treatment')),
  event_type TEXT NOT NULL, -- 'impression' | 'conversion' | 'click' | 'booking'
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT, -- 匿名ユーザー追跡
  page_path TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS（インサート公開、読み取りは管理者のみ）
ALTER TABLE ab_test_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ab_test_insert" ON ab_test_events FOR INSERT WITH CHECK (true);
-- 管理者は全件読み取り（service roleで読む）

-- インデックス
CREATE INDEX IF NOT EXISTS idx_ab_test_key ON ab_test_events(experiment_key);
CREATE INDEX IF NOT EXISTS idx_ab_test_event_type ON ab_test_events(experiment_key, event_type);
CREATE INDEX IF NOT EXISTS idx_ab_test_created ON ab_test_events(created_at);
