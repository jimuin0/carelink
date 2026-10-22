-- 同じ Google の店舗（Place ID）を 2 つの施設に付けられないようにする（2026年10月23日）。
--
-- 【欠陥】店舗オーナーが GBP 設定に他店の Place ID を保存すると、その店舗の Google 評価・件数が自店の掲載
--   （検索結果・ランキング・店舗ページ）に Google ロゴ付きで表示された。保存時に見ていたのは ID の形式だけで、
--   facility_profiles.gbp_place_id には一意性の制約も無かった（索引は非ユニークの idx_facility_gbp_sync だけ）。
--   CareLink 上の競合店の ID もそのまま付けられた。
--
-- 【直し方】
--   - 保存時の照合（Google の店舗情報と施設の電話番号、または店舗名＋住所）はアプリ側
--     （src/lib/gbp-ownership.ts・/api/admin/gbp/place）で行う。
--   - この migration は「同じ Place ID を別の施設へ付ける」ことを DB で止める部分ユニーク索引を足す。
--     保存 RPC（save_admin_facility_integration_atomic の gbp:connect）が受ける 23505 は、アプリが
--     「この Place ID は別の店舗に登録されています」として 409 で返す（src/lib/admin-facility-integration-write.ts）。
--     空文字・空白だけの値は「未設定」と同じ扱い（fetchPlaceDetails も cron も使わない）なので索引に含めない。
--
-- 【既存データ】本番の facility_profiles に同じ Place ID が 2 施設以上に付いていると、索引を作れない。
--   その場合は何も変えずに、件数を添えた例外で止める（データの削除・書き換えはしない）。
--   どの施設に残すかはオーナーに確認して運営が決める。確認用の SELECT は scripts/diagnose-gbp-place-ids.sql。
--   決めた後でこの migration をもう一度適用する。
--
-- 【デプロイ順】どちらが先でも安全。
--   - migration が先: デプロイ前のアプリ（origin/fix/fourth-sweep-integration）は重複保存で 23505 を受け、
--     既存の「設定が変更されました。再読み込みしてください」（409）を返す。保存は起きない。
--   - アプリが先: 保存時の照合はアプリだけで効く。索引ができるまでは同じ ID の重複保存は止まらない（今と同じ）。
--   推奨はアプリのデプロイ直後に適用すること。期待スキーマ（schema-fingerprint.expected.json）は CI が生成する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

DO $duplicates$
DECLARE duplicated integer;
BEGIN
 SELECT count(*) INTO duplicated FROM (
  SELECT gbp_place_id FROM public.facility_profiles WHERE btrim(gbp_place_id)<>'' GROUP BY gbp_place_id HAVING count(*)>1
 ) d;
 IF duplicated>0 THEN
  RAISE EXCEPTION 'GBP_PLACE_ID_DUPLICATED: % Place ID(s) are attached to more than one facility. Nothing was changed. Run scripts/diagnose-gbp-place-ids.sql, decide with the owners which facility keeps each ID, then apply this migration again.', duplicated;
 END IF;
END $duplicates$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_profiles_gbp_place_id
 ON public.facility_profiles (gbp_place_id) WHERE btrim(gbp_place_id)<>'';
COMMENT ON INDEX public.uq_facility_profiles_gbp_place_id IS
 'One Google Place ID per facility, so an owner cannot attach another listing (and its Google rating) to their own facility. Blank values mean unset and are excluded.';
