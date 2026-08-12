-- =============================================================================
-- treatment_* 3表が「0件」に見える件の切り分け（2026年8月11日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- 🔴 【先に読むこと＝3表は「0件」の意味が違う】
--   コード（migration）を読んだ時点で、次が確定している:
--
--   treatment_catalogs … `treatment_catalogs_public_read` FOR SELECT USING (true) があり、
--                        anon でも全件見える。よって anon で 0 件なら【本当に 0 件】。
--   treatment_plans    … ポリシーは `treatment_plans_facility_all` FOR ALL USING(
--   treatment_records     EXISTS(facility_members … role IN ('owner','admin'))) の 1 本だけ。
--                        SELECT 用の公開ポリシーが無いので、anon や「その施設のメンバーでない
--                        ログインユーザー」からは【行があっても必ず 0 件に見える】。
--
--   つまり anon キー経由で数えた「3表とも0件」は、plans / records については
--   データ消失の証拠にならない。RLS を素通しする本 SQL で数え直すのが先。
--
-- @check treatment_catalogs.facility_id
-- @check treatment_plans.facility_id
-- @check treatment_records.facility_id
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

-- ① RLS を素通しした真の件数（SQL Editor は postgres 権限で走る）
SELECT 'treatment_catalogs' AS table_name, count(*) AS rows FROM treatment_catalogs
UNION ALL SELECT 'treatment_plans',  count(*) FROM treatment_plans
UNION ALL SELECT 'treatment_records', count(*) FROM treatment_records;

-- ② ①が 0 でなければ「消えていない・RLS で見えていなかっただけ」で決着。
--    ①が 0 だったときだけ、以下で消えた経路を絞る。

-- ②-a RLS ポリシーの実態（上の前提が本番でも成立しているかの確認）
SELECT tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE tablename IN ('treatment_catalogs', 'treatment_plans', 'treatment_records')
ORDER BY tablename, policyname;

-- ②-b 親の消滅による連鎖削除の確認。
--     3表とも facility_id は `REFERENCES facility_profiles(id) ON DELETE CASCADE`。
--     施設プロファイルを 1 行消すと、その施設の施術記録・治療計画・症例カタログは
--     【何の警告も無く全て消える】。施設が減っていないかをまず見る。
SELECT status, count(*) AS facilities FROM facility_profiles GROUP BY status ORDER BY status;

-- ②-c 監査ログに削除の記録が残っていないか（audit_logs は fire-and-forget なので
--     「無い＝やっていない」の証明にはならないが、「有る＝やった」の証拠にはなる）。
SELECT created_at, user_id, action, table_name, record_id
FROM audit_logs
WHERE table_name IN ('treatment_catalogs', 'treatment_plans', 'treatment_records', 'facility_profiles')
  AND action IN ('delete', 'DELETE')
ORDER BY created_at DESC
LIMIT 50;

-- =============================================================================
-- 【コード側で既に潰した仮説（再調査不要）】
--   ・migration による DROP / TRUNCATE …… 無い。3表とも CREATE TABLE IF NOT EXISTS のみで、
--     DROP TABLE も TRUNCATE も DELETE FROM も 1 箇所も存在しない（全 migration を走査済み）。
--   ・API による一括削除 …………………… 無い。削除経路は
--     `/api/admin/catalog/[id]` DELETE の 1 本だけで、id 指定＋facility_id 一致の単行削除。
--     `/api/account/delete` は treatment_records / treatment_plans の user_id を
--     NULL に更新するだけで、行は消さない。
--   ・cron による削除 ………………………… 無い（treatment_* を参照する cron は存在しない）。
-- =============================================================================
