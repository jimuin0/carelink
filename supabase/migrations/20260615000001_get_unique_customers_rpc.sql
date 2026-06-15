-- 20260615000001_get_unique_customers_rpc.sql
-- T20: 管理「顧客管理」一覧の顧客集計を DB 側に移譲（全行取得→DB集計・発症前予防）
--
-- 【背景・根本原因（事実）】
--   src/lib/admin.ts getUniqueCustomers は customer_visits の対象施設「全来店行」を
--   ネットワーク越しに取得し、JS の Map で email_canonical 単位に集計していた。
--   来店履歴が積み上がる施設ほど転送・メモリが線形に悪化する（一覧表示の度に全行転送）。
--
-- 【対策】
--   email_canonical（20260607_email_canonical_column.sql の GENERATED 列＝
--   src/lib/email-canonical.ts canonicalizeEmail と同一出力）をキーに、
--   来店回数(COUNT)・最終来店(MAX)・代表表示値（最新来店行の原文 email/name）を
--   1 回の集計クエリで返す。JS 側の突合ロジックを SQL で複製せず GENERATED 列に委ねる
--   ことでドリフトを防ぐ。
--
--   返却仕様は既存 JS と一致:
--     - 一意性キー = COALESCE(email_canonical, customer_email)（列欠落時の保険で customer_email）
--     - email/name = 当該顧客の「最新来店行」の原文値（DESC 先頭）
--     - visit_count = 当該顧客の来店行数
--     - last_visit = 当該顧客の最大 visit_date
--     - 並び順 = 最終来店の降順
--
-- 【セキュリティ】
--   SECURITY INVOKER（既定）。呼び出し元（認証済み施設ユーザー）の RLS 文脈で
--   customer_visits を読む（現行の createServerSupabaseAuthClient と同一権限）。
--   search_path は L6 規約に合わせ固定。EXECUTE は authenticated のみ（管理画面専用）。
--
--   ※ アプリ側（src/lib/admin.ts）は本 RPC を優先しつつ、未適用(PGRST202)・エラー時は
--     従来の JS 集計へフォールバックするため、本 migration 適用前後どちらでも動作する。

CREATE OR REPLACE FUNCTION get_unique_customers(p_facility_id UUID)
RETURNS TABLE(email TEXT, name TEXT, visit_count BIGINT, last_visit DATE)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
  WITH ranked AS (
    SELECT
      customer_email,
      customer_name,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(email_canonical, customer_email)
        ORDER BY visit_date DESC
      ) AS rn,
      COUNT(*)        OVER (PARTITION BY COALESCE(email_canonical, customer_email)) AS cnt,
      MAX(visit_date) OVER (PARTITION BY COALESCE(email_canonical, customer_email)) AS maxd
    FROM customer_visits
    WHERE facility_id = p_facility_id
  )
  SELECT customer_email, customer_name, cnt, maxd
  FROM ranked
  WHERE rn = 1
  ORDER BY maxd DESC;
$$;

GRANT EXECUTE ON FUNCTION get_unique_customers(UUID) TO authenticated;
