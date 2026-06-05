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

-- 注: 後続の REVOKE / GRANT / pg_cron DO ブロック / COMMENT は
-- 20260526000005_rate_limit_supabase_grants.sql へ分離した。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」と CLI 2.75.0 系の文分割器が 42601 を
-- 起こす（2.104.0 で修正済）ため、CLI バージョン非依存にする目的。本ファイルは
-- テーブル/インデックス/RLS と check_rate_limit 定義（末尾＝最終文）のみを保持する。
