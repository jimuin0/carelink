-- Phase 7c: Slack incident thread 集約用テーブル
--
-- 同一 route + 同一 commit で連発する 500 エラー等を Slack 上で 1 スレッドに
-- 集約することで通知 spam を防ぐ。24h で自動失効、pg_cron で 1h 毎に cleanup。
--
-- 使い方:
--   1. 通知前に get_incident_thread(key) で既存スレッド ts を取得
--   2. ts が無ければ chat.postMessage で親メッセージ送信 → ts を取得
--   3. record_incident_thread(key, channel, ts) で記録
--   4. 同じ key の次の通知は thread_ts 指定で reply（同スレッド内に集約）

CREATE TABLE IF NOT EXISTS slack_incident_threads (
  thread_key  TEXT PRIMARY KEY,
  channel     TEXT NOT NULL,
  thread_ts   TEXT NOT NULL,
  event_count INT  NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_slack_threads_expires
  ON slack_incident_threads (expires_at);

-- 既存スレッドを取得（失効済みは無視）
CREATE OR REPLACE FUNCTION get_incident_thread(p_key TEXT)
RETURNS TABLE(channel TEXT, thread_ts TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT t.channel, t.thread_ts
  FROM slack_incident_threads t
  WHERE t.thread_key = p_key AND t.expires_at > NOW()
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 新スレッドを記録、既存なら event_count をインクリメント
CREATE OR REPLACE FUNCTION record_incident_thread(
  p_key       TEXT,
  p_channel   TEXT,
  p_thread_ts TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO slack_incident_threads (thread_key, channel, thread_ts)
  VALUES (p_key, p_channel, p_thread_ts)
  ON CONFLICT (thread_key) DO UPDATE
  SET event_count = slack_incident_threads.event_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION get_incident_thread(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incident_thread(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) TO service_role;

-- 失効済みスレッド record の自動削除（1h 毎、pg_cron 必要）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'slack-threads-cleanup',
      '0 * * * *',
      $cleanup$DELETE FROM slack_incident_threads WHERE expires_at < NOW()$cleanup$
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled - slack_incident_threads cleanup must be scheduled manually';
  END IF;
END $$;

COMMENT ON TABLE slack_incident_threads IS
  'Phase 7c: 同 route + 同 commit の 500 連発を Slack スレッドに集約するための ts キャッシュ。24h で自動失効。';
