-- facility_card_view をマテリアライズドビューに変換（v8.29）
-- 検索ページのパフォーマンス改善: LATERAL JOIN を事前計算

-- 既存のビューを削除
DROP VIEW IF EXISTS facility_card_view;

-- マテリアライズドビューを作成
CREATE MATERIALIZED VIEW IF NOT EXISTS facility_card_view AS
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
  fp.google_rating,
  fp.google_review_count,
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
  COALESCE(photo_agg.photo_count, 0) AS photo_count
FROM facility_profiles fp
LEFT JOIN LATERAL (
  SELECT
    MIN(price) AS min_price,
    MAX(price) AS max_price,
    COUNT(*)::INT AS menu_count
  FROM facility_menus
  WHERE facility_id = fp.id AND price IS NOT NULL AND is_active = true
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

-- CONCURRENT REFRESHに必要なユニークインデックス
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_card_view_id ON facility_card_view(id);

-- よく使われる検索条件のインデックス
CREATE INDEX IF NOT EXISTS idx_facility_card_view_status_prefecture ON facility_card_view(status, prefecture);
CREATE INDEX IF NOT EXISTS idx_facility_card_view_business_type ON facility_card_view(business_type);
CREATE INDEX IF NOT EXISTS idx_facility_card_view_rating ON facility_card_view(rating_avg DESC);

-- 読み取り権限付与
GRANT SELECT ON facility_card_view TO anon, authenticated;

-- リフレッシュ関数（更新があった時にCONCURRENTLYリフレッシュ）
CREATE OR REPLACE FUNCTION refresh_facility_card_view()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY facility_card_view;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- facility_profilesへの変更時にリフレッシュ（STATEMENT-levelで1回だけ）
DROP TRIGGER IF EXISTS trg_refresh_facility_card_view ON facility_profiles;
CREATE TRIGGER trg_refresh_facility_card_view
  AFTER INSERT OR UPDATE OR DELETE ON facility_profiles
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_facility_card_view();

-- coupons変更時にもリフレッシュ
DROP TRIGGER IF EXISTS trg_refresh_facility_card_view_coupons ON coupons;
CREATE TRIGGER trg_refresh_facility_card_view_coupons
  AFTER INSERT OR UPDATE OR DELETE ON coupons
  FOR EACH STATEMENT EXECUTE FUNCTION refresh_facility_card_view();
