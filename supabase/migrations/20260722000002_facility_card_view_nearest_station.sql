-- 【監査C1・恒久根治】facility_card_view に nearest_station（最寄駅名の専用列）を射影する。
-- PR #518 のコード修正は「存在しない nearest_station 列参照による 400 全滅」を access_info への差替で
-- 止めたが、GPS 経路の RPC(search_facilities_nearby) は専用列 fp.nearest_station で駅名検索する一方、
-- 非GPS 経路は access_info しか見られず「nearest_station='渋谷駅' だが access_info に渋谷を含まない施設」を
-- 『渋谷』で検索するとヒットしない非対称が残っていた。view に nearest_station を追加し、コード側で
-- access_info に加え nearest_station も .or() 検索対象にして GPS/非GPS の駅名検索を対称化する。
-- 定義は 20260615000002 の facility_card_view の列順を完全維持し、末尾に fp.nearest_station を追加しただけ。
-- 【重要】CREATE OR REPLACE VIEW は既存列の名前・順序を変更できず、新列は末尾追加のみ許可される
-- （中間挿入は 42P16 "cannot change name of view column" で失敗する）。列は名前で参照するため末尾で機能同一。

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
  fp.google_review_count,
  fp.nearest_station
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
) photo_agg ON true
WHERE fp.status = 'published';

GRANT SELECT ON facility_card_view TO anon, authenticated;
