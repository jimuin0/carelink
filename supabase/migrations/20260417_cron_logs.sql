-- Cron実行監視ログ（v8.32）
-- 各Cronジョブの実行結果を記録してVercelダッシュボードに依存しない監視を実現

CREATE TABLE IF NOT EXISTS cron_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  processed   INTEGER DEFAULT 0,
  skipped     INTEGER DEFAULT 0,
  error_msg   TEXT,
  meta        JSONB
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job_started ON cron_logs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON cron_logs (started_at DESC);

-- 30日以上前のログを自動削除（ストレージ節約）
CREATE OR REPLACE FUNCTION cleanup_old_cron_logs()
RETURNS VOID AS $$
BEGIN
  DELETE FROM cron_logs WHERE started_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- RLS: service role のみ書き込み、admin は読み取り可
ALTER TABLE cron_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_logs_admin_read" ON cron_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
-- INSERT は service role client（RLS bypass）経由のみ許可

COMMENT ON TABLE cron_logs IS 'Vercel Cron ジョブの実行ログ。30日で自動削除。';
