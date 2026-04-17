-- Google口コミデータを facility_profiles に追加
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS google_rating NUMERIC(2,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER DEFAULT 0;

-- facility_card_view を再作成して google_rating/google_review_count を含める
-- (ビュー定義が存在する場合は再作成)
CREATE OR REPLACE VIEW facility_card_view AS
SELECT
  fp.id,
  fp.slug,
  fp.name,
  fp.business_type,
  fp.catch_copy,
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
  fp.latitude,
  fp.longitude,
  fp.status,
  COALESCE(m.min_price, 0) AS min_price,
  COALESCE(m.max_price, 0) AS max_price,
  COALESCE(m.menu_count, 0) AS menu_count,
  COALESCE(c.coupon_count, 0) AS coupon_count,
  COALESCE(ph.photo_count, 0) AS photo_count
FROM facility_profiles fp
LEFT JOIN (
  SELECT facility_id,
         MIN(price) AS min_price,
         MAX(price) AS max_price,
         COUNT(*) AS menu_count
  FROM facility_menus
  WHERE price IS NOT NULL
  GROUP BY facility_id
) m ON m.facility_id = fp.id
LEFT JOIN (
  SELECT facility_id, COUNT(*) AS coupon_count
  FROM facility_coupons
  WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())
  GROUP BY facility_id
) c ON c.facility_id = fp.id
LEFT JOIN (
  SELECT facility_id, COUNT(*) AS photo_count
  FROM facility_photos
  GROUP BY facility_id
) ph ON ph.facility_id = fp.id;
