-- Google口コミデータを facility_profiles に追加
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS google_rating NUMERIC(2,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER DEFAULT 0;

-- facility_card_view を再作成して google_rating/google_review_count を含める
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
