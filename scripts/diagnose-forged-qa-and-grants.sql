-- =============================================================================
-- 施設 Q&A の偽回答・予約者以外への回数券／月額プラン付与の棚卸し（2026年10月22日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。見つかった行の扱い（削除・非公開・
--   取り消し）は人が判断する。migration 20261022150000〜20261022150300 は今後の書き込みを
--   止めるだけで、それまでに作られた行には触れない。
--
-- 【何を探すか】
--   ① 「施設の回答」付きの Q&A のうち、店舗の回答経路（/api/admin/qa → manage_admin_content_atomic）
--      を通っていないと思われるもの。正規の回答は answered_by にその店舗の owner / admin が入り、
--      かつ audit_logs に table_name='facility_qa' の記録が残る。修正前は来院者が PostgREST から
--      answer / status / is_public / answered_by / answered_at を自由に書けたので、
--      answered_by が店舗メンバーでない行は確実に偽装、audit_logs が無い行は要確認。
--      （audit_logs は 2026年8月12日より前は取りこぼしが多いので、「無い＝偽装」とは断定しない）
--   ② 未回答のまま残っている質問の件数（修正前は店舗に通知されていなかった）。
--   ③ 予約したことのない人に付与された月額プラン・回数券（修正前は任意の user_id に付与できた）。
--
-- @check facility_qa.id
-- @check facility_qa.facility_id
-- @check facility_qa.user_id
-- @check facility_qa.status
-- @check facility_qa.is_public
-- @check facility_qa.answered_by
-- @check facility_qa.answered_at
-- @check facility_qa.created_at
-- @check facility_members.facility_id
-- @check facility_members.user_id
-- @check facility_members.role
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check audit_logs.table_name
-- @check audit_logs.record_id
-- @check bookings.facility_id
-- @check bookings.user_id
-- @check user_subscriptions.id
-- @check user_subscriptions.facility_id
-- @check user_subscriptions.user_id
-- @check user_subscriptions.status
-- @check user_subscriptions.created_at
-- @check user_packages.id
-- @check user_packages.facility_id
-- @check user_packages.user_id
-- @check user_packages.sessions_remaining
-- @check user_packages.purchased_at
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

-- ① 回答済みの Q&A と、その回答が店舗の回答経路を通った形跡
SELECT q.id, f.name AS facility_name, q.status, q.is_public, q.created_at, q.answered_at,
  EXISTS (
    SELECT 1 FROM facility_members m
    WHERE m.facility_id = q.facility_id AND m.user_id = q.answered_by AND m.role IN ('owner', 'admin')
  ) AS answered_by_facility_admin,
  EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'facility_qa' AND a.record_id = q.id::text
  ) AS has_admin_audit_log,
  (q.answered_by IS NOT NULL AND q.answered_by = q.user_id) AS answered_by_asker
FROM facility_qa q
JOIN facility_profiles f ON f.id = q.facility_id
WHERE q.status = 'answered'
ORDER BY answered_by_facility_admin, has_admin_audit_log, q.created_at DESC;

-- ② 店舗ごとの未回答の質問
SELECT f.name AS facility_name, count(*) AS pending_questions, min(q.created_at) AS oldest_question
FROM facility_qa q
JOIN facility_profiles f ON f.id = q.facility_id
WHERE q.status = 'pending'
GROUP BY f.name
ORDER BY pending_questions DESC;

-- ③-a 予約したことのない人に付与された月額プラン
SELECT 'user_subscriptions' AS kind, s.id, f.name AS facility_name, s.user_id, s.status, s.created_at
FROM user_subscriptions s
JOIN facility_profiles f ON f.id = s.facility_id
WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.facility_id = s.facility_id AND b.user_id = s.user_id)
ORDER BY s.created_at DESC;

-- ③-b 予約したことのない人に付与された回数券
SELECT 'user_packages' AS kind, p.id, f.name AS facility_name, p.user_id, p.sessions_remaining, p.purchased_at
FROM user_packages p
JOIN facility_profiles f ON f.id = p.facility_id
WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.facility_id = p.facility_id AND b.user_id = p.user_id)
ORDER BY p.purchased_at DESC;
