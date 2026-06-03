-- お客様一覧のサーバ集計 RPC（round4 perf #F）
--
-- 背景: SalonBoard の「お客様管理」はクライアントで bookings 全行(cancelled除く)を取得し
--   Map で来店回数・最終来店を集計していた。PostgREST の db-max-rows(既定1000) により
--   予約が累積した施設では取得行が頭打ちになり、来店回数・最終来店・顧客の取りこぼしが
--   静かに発生していた（誤った集計を「正しい一覧」として表示）。
--   サーバ側 GROUP BY で集計し、生予約行ではなく集計済み顧客行のみを返すことで、
--   生予約 1000 行上限による欠落を解消する。
--
-- セキュリティ: SECURITY DEFINER で RLS を迂回するため、関数内で呼び出し元(auth.uid())が
--   当該施設の owner/admin メンバーであることを必須チェックする（非メンバーは例外で拒否）。
--
-- 集計キー/値はクライアント実装と同一規約に揃える:
--   key  = lower(email が空でなければ email、なければ customer_name)
--   name/email/phone = グループ内で最も新しい予約(booking_date 降順)の値
--   visit_count = 件数 / last_visit = max(booking_date) / 並びは last_visit 降順
CREATE OR REPLACE FUNCTION get_facility_customers(p_facility_id UUID)
RETURNS TABLE (
  customer_key TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  visit_count BIGINT,
  last_visit DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_id = p_facility_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: この施設の顧客一覧を参照する権限がありません';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      lower(COALESCE(NULLIF(b.email, ''), b.customer_name, '')) AS ckey,
      b.customer_name, b.email, b.phone, b.booking_date
    FROM bookings b
    WHERE b.facility_id = p_facility_id
      AND b.status <> 'cancelled'
  )
  SELECT
    base.ckey,
    (array_agg(base.customer_name ORDER BY base.booking_date DESC))[1],
    (array_agg(base.email ORDER BY base.booking_date DESC))[1],
    (array_agg(base.phone ORDER BY base.booking_date DESC))[1],
    count(*)::BIGINT,
    max(base.booking_date)
  FROM base
  GROUP BY base.ckey
  ORDER BY max(base.booking_date) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_facility_customers TO authenticated;
