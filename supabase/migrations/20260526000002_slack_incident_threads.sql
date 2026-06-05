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

-- RLS: deny-by-default。アクセスは SECURITY DEFINER の get/record_incident_thread() 経由のみ。
-- anon/authenticated からの直アクセスを物理的に遮断（fresh replay でも露出しない）。
ALTER TABLE slack_incident_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON slack_incident_threads FROM anon, authenticated;

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

-- 注: record_incident_thread 関数は 20260526000003_slack_incident_threads_record_fn.sql、
-- REVOKE / GRANT / pg_cron DO / COMMENT は 20260526000004_slack_incident_threads_grants.sql
-- へ分離した。「引数付き CREATE FUNCTION の直後に別文が続く」と CLI 2.75.0 系の文分割器が
-- 42601 を起こす（2.104.0 で修正済）ため、CLI バージョン非依存化が目的。
-- 本ファイルはテーブル/インデックス/RLS と get_incident_thread 定義（末尾＝最終文）のみを保持する。
