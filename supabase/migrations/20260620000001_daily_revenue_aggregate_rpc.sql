-- 日次売上集計を「全施設1クエリの集合処理」で行う RPC。
--
-- 背景(事実): 旧 /api/cron/daily-summary は公開施設を1件ずつループし、各施設で
--   bookings を2〜3回 select していた（O(N)）。施設数が増えると Vercel の関数実行時間を
--   超えて timeout し、未処理施設のその日の売上サマリが永久欠落(silent miss)する将来リスクがあった
--   （daily-summary は毎日 JST15:00 に「前日」固定で実行＝繰延しても翌 run は翌日を見るため復旧不能）。
--
-- 本 RPC は per-facility ループを廃し、集合ベースの単一 UPSERT で全施設を一括集計する。
-- 件数に依存せず1クエリで完了するため timeout しない（＝発症前の恒久根治）。
-- 旧 JS ロジックを忠実に再現:
--   - 対象は status='published' の施設、かつ p_date に予約がある施設のみ（旧ループと同条件）。
--   - total_revenue = completed の total_price 合計 / booking_count = 当日全予約数 /
--     completed/cancelled/no_show_count = 各ステータス数。
--   - new/repeat = 当日の非空メール(distinct)について、その施設での p_date より前の予約が
--     有れば repeat、無ければ new。
-- 副作用は daily_revenue_summary への UPSERT のみ。anon/authenticated 実行不可(service_role 限定)。
CREATE OR REPLACE FUNCTION public.aggregate_daily_revenue(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  WITH day_b AS (
    SELECT b.facility_id, b.email, b.status, b.total_price
    FROM public.bookings b
    JOIN public.facility_profiles f ON f.id = b.facility_id AND f.status = 'published'
    WHERE b.booking_date = p_date
  ),
  agg AS (
    SELECT
      facility_id,
      COUNT(*) AS booking_count,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
      COUNT(*) FILTER (WHERE status = 'no_show') AS no_show_count,
      COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) AS total_revenue
    FROM day_b
    GROUP BY facility_id
  ),
  emails AS (
    SELECT DISTINCT facility_id, email
    FROM day_b
    WHERE email IS NOT NULL AND email <> ''
  ),
  classified AS (
    SELECT e.facility_id, e.email,
      EXISTS (
        SELECT 1 FROM public.bookings b2
        WHERE b2.facility_id = e.facility_id
          AND b2.email = e.email
          AND b2.booking_date < p_date
      ) AS is_repeat
    FROM emails e
  ),
  cust AS (
    SELECT facility_id,
      COUNT(*) FILTER (WHERE NOT is_repeat) AS new_customer_count,
      COUNT(*) FILTER (WHERE is_repeat) AS repeat_customer_count
    FROM classified
    GROUP BY facility_id
  )
  INSERT INTO public.daily_revenue_summary
    (facility_id, date, total_revenue, booking_count, completed_count,
     cancelled_count, no_show_count, new_customer_count, repeat_customer_count)
  SELECT a.facility_id, p_date, a.total_revenue, a.booking_count, a.completed_count,
     a.cancelled_count, a.no_show_count,
     COALESCE(c.new_customer_count, 0), COALESCE(c.repeat_customer_count, 0)
  FROM agg a
  LEFT JOIN cust c ON c.facility_id = a.facility_id
  ON CONFLICT (facility_id, date) DO UPDATE SET
     total_revenue = EXCLUDED.total_revenue,
     booking_count = EXCLUDED.booking_count,
     completed_count = EXCLUDED.completed_count,
     cancelled_count = EXCLUDED.cancelled_count,
     no_show_count = EXCLUDED.no_show_count,
     new_customer_count = EXCLUDED.new_customer_count,
     repeat_customer_count = EXCLUDED.repeat_customer_count;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.aggregate_daily_revenue(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aggregate_daily_revenue(date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_revenue(date) TO service_role;
