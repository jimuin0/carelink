-- 20260526000001_rate_limit_supabase.sql の後続文を分離（CLI バージョン非依存化）。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは CLI 2.75.0 系の文分割器が
-- 42601 を起こす（2.104.0 で修正済）。関数を含まない本ファイルへ REVOKE / GRANT /
-- pg_cron cleanup / COMMENT を移した。check_rate_limit と rate_limit_buckets は
-- 20260526000001 で定義済みのため対象は存在する。全て冪等。

-- service_role のみ実行可能（client 側からの抜け道防止）
REVOKE ALL ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, INT, INT) TO service_role;

-- 1時間以上前のバケットを自動削除（メモリ圧迫防止）
-- pg_cron が有効なプロジェクトでのみ動作。未有効でも本 migration は失敗しない。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'rate-limit-cleanup',
      '0 * * * *',
      $cleanup$DELETE FROM rate_limit_buckets WHERE window_start < NOW() - INTERVAL '1 hour'$cleanup$
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled - rate_limit_buckets cleanup must be scheduled manually';
  END IF;
END $$;

COMMENT ON TABLE rate_limit_buckets IS
  'Phase 6: Upstash 廃止に伴う Postgres ベースの rate-limit カウンタ。1時間で自動削除。';
COMMENT ON FUNCTION check_rate_limit(TEXT, INT, INT) IS
  'atomic INCR + ウィンドウ判定。戻り値 TRUE = limited。src/lib/rate-limit.ts から呼ばれる。';
