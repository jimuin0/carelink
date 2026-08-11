-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も落とさずに落ちる）
-- ============================================================================
-- facility_profiles は CareLink shadow / 本番の両方に実在する安全なマーカー。
-- 今回 DROP する facilities / recruits / booking_menus 自身は shadow には無い
-- （定義 migration が無いため）ので、これらをガードには使えない。
DO $g$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'Not CareLink (facility_profiles absent). ref=xzafxiupbflvgbarrihe';
  END IF;
END
$g$;

-- ============================================================================
-- 死んだ旧世代プロトタイプ・テーブル3本を DROP する（2026-08-11）
-- ============================================================================
-- 【対象と後継】いずれも新世代のテーブル/カラムに置き換え済みの旧プロトタイプ
--   （置き換え経緯は先行 migration のコメント参照）:
--     - facilities      → facility_profiles
--     - recruits        → job_postings / facility_jobs
--     - booking_menus   → bookings.menu_ids
--
-- 【本番実測 2026-08-11（ref: xzafxiupbflvgbarrihe・神原さん確認済み）】
--     - facilities    … 3 行（神原さん確認: ゴミデータ、破棄可）
--     - recruits      … 0 行
--     - booking_menus … 0 行
--   3 テーブルとも、これらを参照する外部キー（FK）は他テーブルから 1 本も無い
--   （＝依存ゼロ・DROP しても連鎖破壊が起きない）ことを実測確認済み。
--
-- 【DROP 方式】既定の RESTRICT のまま（CASCADE は使わない）。依存ゼロを確認済みなので
--   RESTRICT で失敗することは無い想定だが、想定外の依存が万一あれば CASCADE と違い
--   「何も壊さずエラーで止まる」ため安全側に倒している。
--
-- 【IF EXISTS による冪等性】この3テーブルには CREATE TABLE を伴う定義 migration が一度も無い
--   （out-of-band 作成の残存だった）。そのため fresh-apply する shadow DB /
--   CI 環境にはそもそも存在せず、IF EXISTS により本 migration は shadow 上で
--   単なる no-op となる。本番（既存インスタンス）に適用したときだけ実際に DROP が起きる。
--
-- 【期待値スナップショットの再生成は不要】shadow はこの3テーブルを一度も持ったことが
--   無いため、`src/lib/schema-fingerprint.expected.json` にもこの3テーブル由来の行は
--   最初から存在しない（`|facilities|` / `|recruits|` / `|booking_menus|` を grep して
--   0 件を確認済み）。よって `scripts/gen-schema-fingerprint.sh` の再実行は不要。
--
-- 【本 migration 適用後の後続作業】`src/lib/known-prod-only.json` から
--   "facilities" / "recruits" / "booking_menus" を削除済み（同 PR）。本番へ本
--   migration を適用するまでの間は、本番にまだ実在するこれら3テーブルが
--   台帳の除外対象から外れているため、スキーマ・フィンガープリント監視が
--   一時的にドリフトとして検出し得る。**マージ後は速やかに本番へ適用すること。**
--
-- 【神原さん承認】3テーブルとも owner 確認済み（facilities の3行はゴミデータと確認）。
-- ============================================================================

DROP TABLE IF EXISTS public.facilities;
DROP TABLE IF EXISTS public.recruits;
DROP TABLE IF EXISTS public.booking_menus;
