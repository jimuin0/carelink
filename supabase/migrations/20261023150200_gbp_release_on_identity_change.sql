-- 照合に使った店舗の登録内容が変わったら、Google の Place ID の登録を外す（2026年10月23日）。
--
-- 【欠陥】Place ID の保存時の照合（src/lib/gbp-ownership.ts）は、Google の店舗情報と facility_profiles の
--   電話番号・店舗名・住所を【その時点で】比べるだけだった。照合に使う値はオーナーが店舗設定から
--   いつでも変えられるため、次の手順で他店の評価を自店の掲載に出せた。
--     1. 電話番号を他店の番号に変える  2. 他店の Place ID を保存する（照合を通る）
--     3. 診断タブを開く（他店の評価・件数が書き込まれる）  4. 電話番号を元に戻す
--   この後は書き込みが起きないので、次の週次 cron まで Google ロゴ付きの評価が検索カード・店舗ページに出続け、
--   Place ID は残るので「地図を見る」「Googleで口コミを書く」は他店を指し、一意索引
--   uq_facility_profiles_gbp_place_id がその ID を占有して本物の店舗が登録できなくなった。
--
-- 【直し方】facility_profiles の BEFORE UPDATE トリガで、Place ID が登録されている施設の
--   照合項目（name / phone / postal_code / prefecture・city・address）が変わったら、
--   gbp_place_id・gbp_cid・gbp_connected_at・google_rating・google_review_count と診断結果（gbp_audit_cache）を外す。
--   変えた後は、新しい登録内容で照合し直して保存してもらう（管理画面の店舗設定・GBP 画面に案内を出している）。
--   併せて、Place ID が変わった（外れた・付け替えた）ときは、経路を問わず評価と診断結果を消す
--   （保存 RPC の gbp:connect は自前でも消している。アプリの照合外れ時の解除 gbp-place-release.ts も同じ）。
--
--   比較は「空白を除いた値」で行い、店舗名と住所は大文字小文字を区別しない（照合側はこれより緩い正規化を
--   しているので、ここで同じと見なした変更が照合の結果を変えることは無い）。都道府県・市区町村・住所は
--   つなげて比べる（店舗設定の保存が政令指定都市の区を市区町村と番地の間で移すため。掲載上の住所の文字列は
--   変わらない）。
--
--   SECURITY DEFINER にしているのは gbp_audit_cache を消すため（authenticated からは SELECT しか許していない）。
--   トリガとしてしか使わないので、関数の実行権限は誰にも与えない。
--
-- 【デプロイ順】どちらが先でも安全。
--   - migration が先: デプロイ前のアプリ（origin/fix/fourth-sweep-integration）でも、照合項目を変えると
--     Place ID が外れる。アプリ側は何も前提にしていない（GBP 画面は外れた状態をそのまま読み込む）。
--   - アプリが先: 診断・cron で照合が外れたときの解除はアプリだけで効く。照合項目の変更による解除は
--     この migration の適用まで効かない（今と同じ）。
--   推奨はアプリのデプロイ直後に適用すること。期待スキーマ（schema-fingerprint.expected.json）は CI が生成する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.release_gbp_place_on_identity_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.gbp_place_id IS NOT NULL AND (
     lower(regexp_replace(coalesce(NEW.name,''),'\s','','g')) IS DISTINCT FROM lower(regexp_replace(coalesce(OLD.name,''),'\s','','g'))
  OR regexp_replace(coalesce(NEW.phone,''),'\s','','g') IS DISTINCT FROM regexp_replace(coalesce(OLD.phone,''),'\s','','g')
  OR regexp_replace(coalesce(NEW.postal_code,''),'\s','','g') IS DISTINCT FROM regexp_replace(coalesce(OLD.postal_code,''),'\s','','g')
  OR lower(regexp_replace(coalesce(NEW.prefecture,'')||coalesce(NEW.city,'')||coalesce(NEW.address,''),'\s','','g'))
     IS DISTINCT FROM lower(regexp_replace(coalesce(OLD.prefecture,'')||coalesce(OLD.city,'')||coalesce(OLD.address,''),'\s','','g'))
 ) THEN
  NEW.gbp_place_id := NULL;
  NEW.gbp_cid := NULL;
  NEW.gbp_connected_at := NULL;
 END IF;
 IF NEW.gbp_place_id IS DISTINCT FROM OLD.gbp_place_id THEN
  NEW.google_rating := NULL;
  NEW.google_review_count := 0;
  DELETE FROM public.gbp_audit_cache WHERE facility_id = NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_gbp_place_on_identity_change() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.release_gbp_place_on_identity_change() IS
 'Detaches the Google Place ID, its rating and the GBP audit cache when the facility identity used for the ownership check (name, phone, postal code, address) changes, so a match made with temporarily borrowed details does not outlive them.';

DROP TRIGGER IF EXISTS trg_release_gbp_on_identity_change ON public.facility_profiles;
CREATE TRIGGER trg_release_gbp_on_identity_change
 BEFORE UPDATE OF name, phone, postal_code, prefecture, city, address, gbp_place_id ON public.facility_profiles
 FOR EACH ROW EXECUTE FUNCTION public.release_gbp_place_on_identity_change();
