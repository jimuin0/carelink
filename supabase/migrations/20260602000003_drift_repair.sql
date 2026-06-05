-- =============================================================================
-- 20260602 Drift Repair — 本番スキーマと repo migration の乖離を一括解消
-- =============================================================================
-- 2026-06-02 ライブプローブ（tests/contract/rpc-probe.test.ts）で本番 public
-- スキーマを実測した結果、過去 migration が out-of-band 適用された影響で以下が
-- 本番に欠落していることを確定した（推測ではなく PGRST202 / 42703 / PGRST205 の
-- 実エラーで確認）:
--
--   1. facility_card_view に google_rating / google_review_count 列が無い
--      → 20260417_google_rating_columns.sql / 20260417_materialized_card_view.sql 未適用
--   2. search_facilities_nearby() 関数が無い（GPS 検索が動作しない）
--      → 20260417_postgis.sql の RPC 部分が未適用
--   3. facility_reviews に reviewer_ip / is_flagged / flag_reason 列が無い
--      → 20260417_review_flagging.sql 未適用（cron/flag-reviews が常時失敗）
--   4. slack_incident_threads テーブル + get/record_incident_thread 関数が無い
--      → 20260526_slack_incident_threads.sql 未適用
--   5. find_bulk_review_ips() 関数が repo にも本番にも存在しない
--      → cron/flag-reviews が呼ぶが migration が一度も書かれていなかった（恒久新規定義）
--   6. public_reviews ビューが無い + facility_reviews の公開/anon-insert ポリシー残存
--      → 20260420_public_reviews_view.sql が存在しない user_id 列を参照して CREATE VIEW
--        失敗 → トランザクション全ロールバックで ①ビュー未作成 ②DROP POLICY 未実行 の
--        二重ドリフト。公開レビュー表示（ReviewTab / lib/facilities）が壊れていた。
--      → 20260420_reviews_anon_insert_rls.sql / reviews_ip_protection.sql も未適用
--   7. trg_sync_facility_location トリガが無い（座標更新で location 不同期 → GPS ズレ）
--      → 20260417_postgis.sql の trigger 部のみ未適用
--   8. referral_codes に "Public read codes"(USING true) が残存
--      → 20260420_referral_uses_rls.sql 未適用（紹介コード全公開）
--
-- 本 migration は全て IF NOT EXISTS / CREATE OR REPLACE / IF EXISTS で冪等。
-- 既に正しい本番には無害（再適用安全）。
--
-- 【本 migration の適用前後で実測検証する手順】
--   適用前 → 適用後 で tests/contract/rpc-probe.test.ts を再実行し全項目解消を確認、
--   かつ本番 public スキーマの introspection dump を再取得して差分ゼロを確認する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (A) facility_profiles の Google 口コミ列（search_facilities_nearby / view の前提）
-- -----------------------------------------------------------------------------
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS google_rating       NUMERIC(2,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER      DEFAULT 0;

-- -----------------------------------------------------------------------------
-- (B) facility_card_view に google 列を追加（CREATE OR REPLACE で末尾追記）
--     本番は phase_c_infra 由来の「素の VIEW」（google 列なし・24 列）。
--     2026-06-02 ライブ実測で本番の現行カラム順を確定:
--       1.id 2.slug 3.name 4.business_type 5.catch_copy 6.description 7.prefecture
--       8.city 9.access_info 10.rating_avg 11.rating_count 12.main_photo_url
--       13.business_hours 14.seat_count 15.status 16.latitude 17.longitude
--       18.features 19.created_at 20.min_price 21.max_price 22.menu_count
--       23.coupon_count 24.photo_count
--     ※ CREATE OR REPLACE VIEW は「既存列を同名・同順で維持し、新列は末尾追記のみ」
--       が制約。google 列を中間に差し込むと 42P16（列名変更不可）で失敗するため、
--       既存 24 列の順序を厳密に踏襲し google_rating / google_review_count を 25・26
--       列目として末尾に追記する。RPC(search_facilities_nearby) も frontend(CARD_COLS)
--       も列を「名前」で参照するため、末尾追記による順序差は無影響。
--     ※ matview 化（20260417_materialized_card_view.sql / v8.29）は採用しない:
--       書き込み毎の REFRESH トリガが write-path に副作用・失敗リスクを足すため、
--       本番が現に依存している素 VIEW セマンティクスを維持する（確実性優先）。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW facility_card_view AS
SELECT
  fp.id,
  fp.slug,
  fp.name,
  fp.business_type,
  fp.catch_copy,
  fp.description,
  fp.prefecture,
  fp.city,
  fp.access_info,
  fp.rating_avg,
  fp.rating_count,
  fp.main_photo_url,
  fp.business_hours,
  fp.seat_count,
  fp.status,
  fp.latitude,
  fp.longitude,
  fp.features,
  fp.created_at,
  COALESCE(menu_agg.min_price, NULL) AS min_price,
  COALESCE(menu_agg.max_price, NULL) AS max_price,
  COALESCE(menu_agg.menu_count, 0) AS menu_count,
  COALESCE(coupon_agg.coupon_count, 0) AS coupon_count,
  COALESCE(photo_agg.photo_count, 0) AS photo_count,
  fp.google_rating,
  fp.google_review_count
FROM facility_profiles fp
LEFT JOIN LATERAL (
  SELECT
    MIN(price) AS min_price,
    MAX(price) AS max_price,
    COUNT(*)::INT AS menu_count
  FROM facility_menus
  WHERE facility_id = fp.id AND price IS NOT NULL
) menu_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS coupon_count
  FROM coupons
  WHERE facility_id = fp.id AND is_active = true
) coupon_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS photo_count
  FROM facility_photos
  WHERE facility_id = fp.id
) photo_agg ON true;

GRANT SELECT ON facility_card_view TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- (C) search_facilities_nearby() — PostGIS GPS 検索 RPC（20260417_postgis.sql と同一定義）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_facilities_nearby(
  user_lat  DOUBLE PRECISION,
  user_lng  DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 10,
  type_filter TEXT DEFAULT NULL,
  limit_count INT DEFAULT 100
)
RETURNS TABLE (
  id            UUID,
  slug          TEXT,
  name          TEXT,
  business_type TEXT,
  catch_copy    TEXT,
  prefecture    TEXT,
  city          TEXT,
  access_info   TEXT,
  rating_avg    NUMERIC,
  rating_count  INT,
  google_rating NUMERIC,
  google_review_count INT,
  main_photo_url TEXT,
  min_price     INT,
  max_price     INT,
  menu_count    INT,
  coupon_count  INT,
  photo_count   INT,
  business_hours JSONB,
  seat_count    INT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  distance_km   DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.id, v.slug, v.name, v.business_type, v.catch_copy,
    v.prefecture, v.city, v.access_info,
    v.rating_avg, v.rating_count, v.google_rating, v.google_review_count,
    v.main_photo_url, v.min_price, v.max_price,
    v.menu_count, v.coupon_count, v.photo_count,
    v.business_hours, v.seat_count,
    fp.latitude, fp.longitude,
    ST_Distance(
      fp.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1000.0 AS distance_km
  FROM facility_card_view v
  JOIN facility_profiles fp ON fp.id = v.id
  WHERE
    v.status = 'published'
    AND fp.location IS NOT NULL
    AND ST_DWithin(
      fp.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_km * 1000
    )
    AND (type_filter IS NULL OR v.business_type = type_filter)
  ORDER BY distance_km ASC
  LIMIT limit_count;
$$;

-- =============================================================================
-- 【分割について】本 migration は元々この後に reviews 列追加 / public_reviews /
-- find_bulk_review_ips / slack_incident_threads + get/record / sync_facility_location
-- 等を続けていたが、「引数付き CREATE FUNCTION の直後に別文が続く」と Supabase CLI
-- 2.75.0 系の文分割器が 1 チャンク化して 42601 を起こす（2.104.0 で修正済）。
-- CLI バージョン非依存にするため、各引数付き関数を「ファイル末尾＝最終文」に分割した:
--   20260602000008_drift_repair_reviews_and_find_bulk_fn.sql    (reviews + find_bulk_review_ips)
--   20260602000009_drift_repair_find_bulk_grants_and_get_fn.sql (find_bulk grants + slack + get)
--   20260602000010_drift_repair_record_fn.sql                   (record_incident_thread)
--   20260602000011_drift_repair_slack_grants_and_sync.sql       (slack grants + sync trigger + referral policy)
-- 本ファイルは Google 列追加 / facility_card_view / search_facilities_nearby（末尾）を保持する。
-- 各分割片は IF NOT EXISTS / CREATE OR REPLACE / IF EXISTS で冪等（本番再適用も無害）。
-- =============================================================================
