-- Webhook失敗リトライキュー（v8.35）
-- LINE/外部サービスへのWebhook送信が失敗した場合に再試行するためのキュー

CREATE TABLE IF NOT EXISTS webhook_retry_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_type  TEXT NOT NULL,          -- 'line_message', 'line_push', 'email', etc.
  target_id     TEXT NOT NULL,           -- 送信先ID（LINE user_id, email等）
  payload       JSONB NOT NULL,          -- 送信内容
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  last_error    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'cancelled')),
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  facility_id   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_retry_pending
  ON webhook_retry_queue (scheduled_at, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_retry_facility
  ON webhook_retry_queue (facility_id)
  WHERE facility_id IS NOT NULL;

-- 7日以上前の完了・失敗エントリを自動削除
CREATE OR REPLACE FUNCTION cleanup_old_webhook_retry()
RETURNS VOID AS $$
BEGIN
  DELETE FROM webhook_retry_queue
  WHERE status IN ('success', 'failed', 'cancelled')
    AND created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE webhook_retry_queue ENABLE ROW LEVEL SECURITY;

-- service role のみ操作（cronジョブから呼び出す）
COMMENT ON TABLE webhook_retry_queue IS 'LINE通知・メール送信の失敗リトライキュー。最大3回リトライ、指数バックオフ。';
