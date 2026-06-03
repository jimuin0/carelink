-- Phase 6: Upstash 廃止 → Supabase Postgres で rate-limit を代替
-- 2026-04 に Upstash インスタンスが削除されて mutation API 全 500 化した事故の
-- 構造的再発防止。Upstash ベンダー依存を完全に切り、既存 Supabase で代用する。

-- バケットテーブル（atomic INCR + ウィンドウ管理）
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          TEXT        PRIMARY KEY,
  count        INT         NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
  ON rate_limit_buckets (window_start);

-- RLS: deny-by-default。アクセスは SECURITY DEFINER の check_rate_limit() 経由のみ。
-- anon/authenticated からの直アクセスを物理的に遮断（fresh replay でも露出しない）。
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit_buckets FROM anon, authenticated;

-- atomic INCR + ウィンドウ判定の RPC
-- 戻り値 TRUE = limited（429 を返すべき）
-- 戻り値 FALSE = allowed
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key       TEXT,
  p_limit     INT,
  p_window_ms INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO rate_limit_buckets (key, count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN rate_limit_buckets.window_start < NOW() - (p_window_ms || ' ms')::INTERVAL
          THEN 1
        ELSE rate_limit_buckets.count + 1
      END,
      window_start = CASE
        WHEN rate_limit_buckets.window_start < NOW() - (p_window_ms || ' ms')::INTERVAL
          THEN NOW()
        ELSE rate_limit_buckets.window_start
      END
  RETURNING count INTO v_count;
  RETURN v_count > p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
