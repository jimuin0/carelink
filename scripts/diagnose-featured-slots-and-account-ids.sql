-- =============================================================================
-- 広告枠（featured_slots）の自己付与と、アカウント ID の公開範囲の棚卸し（2026年10月23日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。見つかった行の扱い（無効化・削除）は
--   人が判断する。migration 20261023110000〜20261023110200 は今後の書き込み・読み取りを止めるだけで、
--   それまでに作られた行には触れない。
--
-- 【何を探すか】
--   ① featured_slots の全行。正規の作成は /api/admin/featured-ads（is_active=false で作り、
--      audit_logs に table_name='featured_slots'・action='create' を残す）だけで、有効化は Stripe の
--      webhook だけ。修正前は店舗のオーナー／管理者が PostgREST から直接作成・有効化・期限延長できた。
--      本番は 0 行の想定。行があれば、監査ログの無い行（＝API を通っていない）から確認する
--      （audit_logs は 2026年8月12日より前は取りこぼしが多いので、「無い＝自己付与」とは断定しない）。
--      ⚠️ featured_slots.stripe_session_id はどのコードも書いていない（webhook は is_active だけを更新する）
--      ので、NULL であることは「未払い」の印にならない。
--   ② 適用後の確認: ブラウザのロール（anon / authenticated）が featured_slots に書けないこと、
--      facility_qa の user_id / answered_by と review_helpful を読めないこと。適用前は false が並ぶ。
--   ③ 修正前に匿名で読めていた範囲（公開 Q&A の質問者 ID の件数・「役に立った」の件数）。
--
-- @check featured_slots.id
-- @check featured_slots.facility_id
-- @check featured_slots.slot_type
-- @check featured_slots.area
-- @check featured_slots.business_type
-- @check featured_slots.starts_at
-- @check featured_slots.ends_at
-- @check featured_slots.is_active
-- @check featured_slots.stripe_session_id
-- @check featured_slots.created_at
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check facility_profiles.status
-- @check audit_logs.table_name
-- @check audit_logs.record_id
-- @check audit_logs.action
-- @check facility_qa.user_id
-- @check facility_qa.status
-- @check facility_qa.is_public
-- @check review_helpful.id
-- =============================================================================


-- =============================================================================
-- 🔴 接続先ガード（先頭で必ず実行される）
--
-- Supabase の SQL Editor はプロジェクトごとにタブが開くため、【別プロジェクトのタブに
-- 貼ってしまう】事故が繰り返し起きている（2026年8月2日 soel で実行し「RLS が90本欠落」
-- という存在しない事故を報告しかけた／2026年8月12日 admin-dashboard で実行し
-- 「audit_logs が存在しない」となった）。人の注意力では防げないので、SQL 自身に検査させる。
--
-- CareLink 本番 project ref = xzafxiupbflvgbarrihe
-- 目印テーブルが揃っていなければ、以降を1行も実行せずに落とす。
-- =============================================================================
DO $connguard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.facility_menus') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      '接続先が CareLink 本番ではありません。project ref = xzafxiupbflvgbarrihe のタブで実行してください（現在の接続先には facility_profiles / facility_menus / audit_logs のいずれかがありません）';
  END IF;
END
$connguard$;

-- ① 広告枠の全行と、API を通った形跡（監査ログ）
SELECT s.id, f.name AS facility_name, f.status AS facility_status, s.slot_type, s.area, s.business_type,
  s.starts_at, s.ends_at, s.is_active,
  (s.is_active AND s.starts_at <= now() AND s.ends_at >= now()) AS shown_as_sponsor_now,
  s.stripe_session_id, s.created_at,
  EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'featured_slots' AND a.action = 'create' AND a.record_id = s.id::text
  ) AS has_api_audit_log
FROM featured_slots s
JOIN facility_profiles f ON f.id = s.facility_id
ORDER BY has_api_audit_log, shown_as_sponsor_now DESC, s.created_at DESC;

-- ② 適用後の確認（全て true になっていれば 3 本とも適用済み）
SELECT
  (to_regclass('public.facility_profiles') IS NOT NULL) AS is_carelink,
  NOT has_any_column_privilege('authenticated', 'public.featured_slots', 'INSERT')
    AND NOT has_any_column_privilege('authenticated', 'public.featured_slots', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.featured_slots', 'DELETE')
    AND has_table_privilege('anon', 'public.featured_slots', 'SELECT') AS featured_slots_browser_read_only,
  NOT has_column_privilege('anon', 'public.facility_qa', 'user_id', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.facility_qa', 'answered_by', 'SELECT')
    AND has_column_privilege('anon', 'public.facility_qa', 'question', 'SELECT') AS qa_account_ids_hidden,
  NOT has_any_column_privilege('anon', 'public.review_helpful', 'SELECT') AS helpful_votes_hidden_from_anon,
  (to_regprocedure('public.get_review_helpful_counts(uuid[])') IS NOT NULL) AS helpful_count_function_present;

-- ③ 修正前に匿名で読めていた範囲
SELECT
  (SELECT count(*) FROM facility_qa q WHERE q.status = 'answered' AND q.is_public AND q.user_id IS NOT NULL)
    AS public_questions_with_asker_id,
  (SELECT count(*) FROM review_helpful h) AS helpful_votes;
