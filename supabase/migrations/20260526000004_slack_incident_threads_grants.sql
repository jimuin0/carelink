-- 20260526000002_slack_incident_threads.sql の後続文を分離（CLI バージョン非依存化）。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは CLI 2.75.0 系の文分割器が
-- 42601 を起こす（2.104.0 で修正済）。関数を含まない本ファイルへ REVOKE / GRANT /
-- pg_cron cleanup / COMMENT を移した。get_incident_thread は 20260526000002、
-- record_incident_thread は 20260526000003 で定義済みのため対象は存在する。全て冪等。

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
