-- 2026年6月26日: 外部API v1 顧客一覧の「ユニーク顧客の正確なページング」を DB 側で実現する RPC。
--
-- 背景（事実・敵対監査 SEO-2 で確定）:
--   src/app/api/v1/customers/route.ts は bookings を range() でページングし、取得した1ページ内だけで
--   JS の Set 重複除去をしていた。このため (1) pagination.total に bookings の生件数（重複込み）を返し
--   ユニーク顧客数と乖離、(2) 同一顧客が複数ページに跨る・1ページの実件数が limit 未満になる、という
--   二重の破綻があった。外部API連携先（POS・会計ソフト）のページング計算が狂う。
--
-- 修正（対症療法でなく設計の根治）:
--   DISTINCT ON でユニーク顧客（キー = user_id ?? phone ?? customer_name。route の dedup と同一）を
--   DB 側で確定し、COUNT(*) OVER() で「ユニーク顧客の総数」をページ行に同梱して返す。
--   これにより total はユニーク顧客数、ページングはユニーク顧客単位で正確になる。
--   並び順は最新予約（created_at DESC）を代表行とし、結果は同 created_at 降順で安定ページング。
--
-- セキュリティ: SECURITY INVOKER（既定）だが本 API は service_role から呼ぶ（RLS 迂回）。
--   facility スコープは p_facility_id で限定（route 側で API キーの facility に固定）。
--   search_path は L6 規約に合わせ固定。
--
-- 冪等性: CREATE OR REPLACE。再適用安全。

CREATE OR REPLACE FUNCTION get_facility_customers_v1(
  p_facility_id UUID,
  p_search TEXT,
  p_limit INT,
  p_offset INT
)
RETURNS TABLE(name TEXT, phone TEXT, email TEXT, total_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH deduped AS (
    SELECT DISTINCT ON (COALESCE(b.user_id::text, b.phone, b.customer_name))
      b.customer_name AS name,
      b.phone         AS phone,
      b.email         AS email,
      b.created_at    AS created_at
    FROM bookings b
    WHERE b.facility_id = p_facility_id
      AND b.customer_name IS NOT NULL
      AND (
        p_search IS NULL
        OR b.customer_name ILIKE '%' || p_search || '%'
        OR b.phone ILIKE '%' || p_search || '%'
      )
    ORDER BY COALESCE(b.user_id::text, b.phone, b.customer_name), b.created_at DESC
  )
  SELECT
    d.name,
    d.phone,
    d.email,
    COUNT(*) OVER() AS total_count
  FROM deduped d
  ORDER BY d.created_at DESC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION get_facility_customers_v1(UUID, TEXT, INT, INT) TO authenticated, service_role;
