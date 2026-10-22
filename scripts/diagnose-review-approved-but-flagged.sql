-- =============================================================================
-- 承認済みなのに非公開のまま止まった口コミの棚卸し（2026年10月23日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。見つかった行をどう戻すか
--   （is_flagged=false に戻す／審査待ちを作り直す）は運営が内容を見て判断する。
--
-- 【何を探すか】
--   運営が承認した口コミを投稿者が星だけ編集すると、/api/review/[id] が禁止表現を再検出して
--   is_flagged=true に戻していた（本文が変わらないので審査待ちの行は作られない）。
--   この口コミは公開ページ（public_reviews）と評価の集計から外れ、運営の審査画面にも出ず、
--   承認のやり直しも moderate_review_content_atomic が REVISION_CONFLICT で拒む。
--   migration 20261023120000 で今後の編集は直したが、それまでにできた行は残る。
--   店舗画面・マイページはこの状態を「公開手続きの停止」（運営へ問い合わせ）と表示する
--   （src/lib/review-moderation-state.ts の 'stalled'）。
--
--   content_unchanged_since_approval が true の行は、承認した時点と本文が同じ＝星だけの編集で
--   止まった行。false の行は承認後に本文も変わっており、改めて審査が要る。
--
-- @check facility_reviews.id
-- @check facility_reviews.facility_id
-- @check facility_reviews.is_flagged
-- @check facility_reviews.flag_reason
-- @check facility_reviews.status
-- @check facility_reviews.created_at
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check moderation_queue.id
-- @check moderation_queue.content_type
-- @check moderation_queue.content_id
-- @check moderation_queue.status
-- @check moderation_queue.created_at
-- @check moderation_queue.reviewed_at
-- @check moderation_queue.decision_content_hash
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

-- ① 該当する口コミ（最新の審査が承認・審査待ちの行が無い・旗が立っている）
WITH latest AS (
  SELECT DISTINCT ON (q.content_id) q.id
  FROM moderation_queue q
  WHERE q.content_type = 'review'
  ORDER BY q.content_id, q.created_at DESC
)
SELECT r.id, f.name AS facility_name, r.status, r.is_flagged, r.flag_reason, r.created_at,
  m.reviewed_at AS approved_at,
  m.decision_content_hash = public.moderation_review_context_hash(m, r) AS content_unchanged_since_approval,
  (to_regclass('public.facility_profiles') IS NOT NULL) AS is_carelink
FROM latest l
JOIN moderation_queue m ON m.id = l.id
JOIN facility_reviews r ON r.id = m.content_id
LEFT JOIN facility_profiles f ON f.id = r.facility_id
WHERE r.is_flagged IS DISTINCT FROM false
  AND m.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM moderation_queue p
    WHERE p.content_type = 'review' AND p.content_id = r.id AND p.status IN ('pending', 'escalated')
  )
ORDER BY m.reviewed_at DESC;

-- ② 件数だけ（0 なら対応不要）
WITH latest AS (
  SELECT DISTINCT ON (q.content_id) q.id
  FROM moderation_queue q
  WHERE q.content_type = 'review'
  ORDER BY q.content_id, q.created_at DESC
)
SELECT count(*) AS stalled_reviews,
  (to_regclass('public.facility_profiles') IS NOT NULL) AS is_carelink
FROM latest l
JOIN moderation_queue m ON m.id = l.id
JOIN facility_reviews r ON r.id = m.content_id
WHERE r.is_flagged IS DISTINCT FROM false
  AND m.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM moderation_queue p
    WHERE p.content_type = 'review' AND p.content_id = r.id AND p.status IN ('pending', 'escalated')
  );
