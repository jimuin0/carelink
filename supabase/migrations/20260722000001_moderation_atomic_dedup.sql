-- 【監査H2/H3 low・恒久根治】moderation_queue の重複pending投入を DB 側で原子的に排除する。
-- 現状：/api/report と cron/flag-reviews は「pending 既存を SELECT → 無ければ INSERT」の best-effort
-- dedup で、並行通報や別cronが SELECT と INSERT の間に割り込むと同一コンテンツの pending 行が
-- 重複挿入され得る。pending に限定した部分ユニークindexで「同一コンテンツの pending は1件」を保証し、
-- INSERT ... ON CONFLICT DO NOTHING を行う SECURITY DEFINER 関数経由に一本化して競合を根絶する。
-- approve/reject 後（status が pending 以外に変わる）の再フラグは部分indexの対象外のため引き続き可能。

CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_pending_content
  ON moderation_queue (content_type, content_id) WHERE status = 'pending';

-- 審査キュー投入をアトミックに行う関数。JSONB 配列で複数件（cron のバッチ）を一括投入でき、
-- 既に pending がある content は ON CONFLICT DO NOTHING でスキップする（バッチ全体を壊さない）。
-- 戻り値＝実際に投入した行数。
CREATE OR REPLACE FUNCTION enqueue_moderation(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO moderation_queue (content_type, content_id, facility_id, reporter_id, report_reason, auto_flags, status)
  SELECT
    x.content_type,
    x.content_id,
    x.facility_id,
    x.reporter_id,
    x.report_reason,
    COALESCE(x.auto_flags, '[]'::jsonb),
    'pending'
  FROM jsonb_to_recordset(p_items) AS x(
    content_type  text,
    content_id    uuid,
    facility_id   uuid,
    reporter_id   uuid,
    report_reason text,
    auto_flags    jsonb
  )
  ON CONFLICT (content_type, content_id) WHERE status = 'pending' DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- API はサーバ信頼文脈（service_role）から rpc で呼ぶ。SECURITY DEFINER のため所有者権限で実行される。
GRANT EXECUTE ON FUNCTION enqueue_moderation(jsonb) TO service_role;
