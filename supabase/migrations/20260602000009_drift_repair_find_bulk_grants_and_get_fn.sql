-- 20260602000003_drift_repair.sql からの分割 (3/5) — CLI バージョン非依存化。
-- find_bulk_review_ips の REVOKE/GRANT（定義は 20260602000008）＋ slack_incident_threads
-- テーブル/インデックス＋ get_incident_thread（末尾＝最終文）。引数付き関数を末尾にするため
-- record_incident_thread と各 grants は後続ファイル(000010/000011)へ分離。CLI 2.75.0 の 42601 回避。冪等。

REVOKE ALL ON FUNCTION find_bulk_review_ips(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_bulk_review_ips(TIMESTAMPTZ, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- (F) slack_incident_threads テーブル + 関数（20260526_slack_incident_threads.sql）
-- -----------------------------------------------------------------------------
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
