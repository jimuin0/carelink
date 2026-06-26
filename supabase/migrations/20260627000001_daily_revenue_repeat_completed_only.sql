-- daily_revenue 集計の new/repeat 顧客判定を「過去の completed 予約のみ」に限定する根治。
--
-- 背景(事実): aggregate_daily_revenue(date) の is_repeat 判定 EXISTS は、過去(p_date 未満)に
--   その施設・同一メールの予約が「1件でも」あれば repeat としていた（status 無条件）。
--   このため、過去に cancelled / no_show しかない（＝一度も来店していない）顧客まで repeat に
--   誤計上され、new_customer_count / repeat_customer_count が不正確になっていた。
-- 修正: 「来店した」= status='completed' の過去予約がある場合のみ repeat とみなす。
--   それ以外（初回・過去がキャンセル/no_show のみ）は new。集計の他項目は不変。
--
-- 本ファイルは 20260620000001 の関数定義を CREATE OR REPLACE で置き換える（is_repeat の
-- EXISTS に AND b2.status = 'completed' を1行追加しただけ。他ロジックは忠実に維持）。
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
          -- 「来店した」過去予約のみ repeat とみなす（cancelled / no_show は来店ではない）。
          AND b2.status = 'completed'
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
