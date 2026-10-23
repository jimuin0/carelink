-- =============================================================================
-- GBP の Place ID の棚卸し（2026年10月23日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- 【何を見るか】
--   ① 同じ Place ID が 2 施設以上に付いていないか。付いていると migration
--      20261023150000_gbp_place_id_unique.sql は GBP_PLACE_ID_DUPLICATED で止まる（何も変えない）。
--      どの施設に残すかをオーナーに確認してから、残さない側を管理画面で空にして保存してもらう
--      （または運営が直す）。その後に migration を適用し直す。
--   ② Place ID が付いている施設の一覧。保存時の照合（電話番号、または店舗名＋住所。src/lib/gbp-ownership.ts）
--      は今後の保存にしか効かない。照合の導入前に保存された ID は、評価の書き込み（管理画面の診断・週次 cron）
--      では照合されて合わなければ評価が消えるが、店舗ページの「地図を見る」「Googleで口コミを書く」は
--      保存済みの ID をそのまま使う。Google マップで place_id を開き、その施設の店舗か目で確かめる:
--      https://www.google.com/maps/place/?q=place_id:<gbp_place_id>
--
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check facility_profiles.status
-- @check facility_profiles.phone
-- @check facility_profiles.city
-- @check facility_profiles.address
-- @check facility_profiles.gbp_place_id
-- @check facility_profiles.gbp_connected_at
-- @check facility_profiles.google_rating
-- @check facility_profiles.google_review_count
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

-- ① 2 施設以上に付いている Place ID（0 行なら migration 20261023150000 はそのまま適用できる）
SELECT f.gbp_place_id, count(*) AS facilities,
  string_agg(f.name || '（' || f.status || '・' || f.id::text || '）', ' / ' ORDER BY f.gbp_connected_at NULLS LAST) AS attached_to
FROM facility_profiles f
WHERE btrim(f.gbp_place_id) <> ''
GROUP BY f.gbp_place_id
HAVING count(*) > 1
ORDER BY facilities DESC;

-- ② Place ID が付いている施設（Google マップで place_id を開いて、その施設の店舗か確かめる）
SELECT f.id, f.name, f.status, f.phone, f.city, f.address, f.gbp_place_id, f.gbp_connected_at,
  f.google_rating, f.google_review_count,
  'https://www.google.com/maps/place/?q=place_id:' || f.gbp_place_id AS google_maps_url
FROM facility_profiles f
WHERE btrim(f.gbp_place_id) <> ''
ORDER BY f.status, f.name;
