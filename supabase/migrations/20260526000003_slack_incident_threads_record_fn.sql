-- 20260526000002_slack_incident_threads.sql から record_incident_thread を分離
-- （CLI バージョン非依存化）。「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは
-- CLI 2.75.0 系の文分割器が 42601 を起こす（2.104.0 で修正済）。各引数付き関数を
-- 「ファイル末尾＝最終文」にするため、record 関数を独立ファイルにした。
-- slack_incident_threads テーブルは 20260526000002 で定義済み。冪等（CREATE OR REPLACE）。

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
