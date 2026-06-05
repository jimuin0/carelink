-- 20260602000003_drift_repair.sql からの分割 (4/5) — CLI バージョン非依存化。
-- record_incident_thread（引数付き）を独立ファイル末尾に置く（CLI 2.75.0 の 42601 回避）。
-- slack_incident_threads テーブルは 20260602000009 で定義済。冪等（CREATE OR REPLACE）。

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
