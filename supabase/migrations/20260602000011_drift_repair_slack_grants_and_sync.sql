-- 20260602000003_drift_repair.sql からの分割 (5/5) — CLI バージョン非依存化。
-- get/record_incident_thread の REVOKE/GRANT（定義は 20260602000009/000010）＋
-- sync_facility_location トリガ関数（引数なし＝42601 条件外）＋ trigger/UPDATE＋
-- referral_codes の公開ポリシー撤去。引数付き関数を含まないため後続文があっても安全。冪等。

REVOKE ALL ON FUNCTION get_incident_thread(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incident_thread(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- (G) facility_profiles.location 自動同期トリガ（20260417_postgis.sql の trigger 部）
--     本番には location 列・GiST インデックス・search_facilities_nearby は載ったが、
--     lat/lng 更新時に location を再計算する trg_sync_facility_location が欠落していた
--     （ライブdump の TRG 一覧に不在を確認）。これが無いと施設が座標を更新しても
--     location が古いまま → GPS 検索結果がズレる/欠ける。冪等再作成する。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_facility_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_facility_location ON facility_profiles;
CREATE TRIGGER trg_sync_facility_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON facility_profiles
  FOR EACH ROW EXECUTE FUNCTION sync_facility_location();

-- トリガ欠落期間中に lat/lng が更新された行の location を一括是正（冪等・副作用なし）。
UPDATE facility_profiles
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND (
    location IS NULL
    OR location IS DISTINCT FROM ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  );

-- -----------------------------------------------------------------------------
-- (H) referral_codes の公開読み取りポリシー撤去（20260420_referral_uses_rls.sql）
--     "Public read codes" (USING true) は紹介コードを anon に全公開してしまうため
--     撤去するのが repo の確定意図。本番に残存していた（dump POL 一覧で確認、現状
--     テーブルは 0 行のため実害は未発生だが完璧基準で恒久撤去）。
--     正規ポリシー（own_select / own_insert）は 20260405_referral_program.sql 由来で存置。
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read codes" ON referral_codes;
