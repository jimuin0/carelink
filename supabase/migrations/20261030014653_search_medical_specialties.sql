-- Preserve existing view columns and RPC result order while matching any selected specialty.
BEGIN;
CREATE OR REPLACE VIEW public.facility_card_view WITH (security_invoker=true,security_barrier=true) AS
 SELECT fp.id,fp.slug,fp.name,fp.business_type,fp.catch_copy,fp.description,fp.prefecture,fp.city,fp.access_info,
 fp.rating_avg,fp.rating_count,fp.main_photo_url,fp.business_hours,fp.seat_count,fp.status,fp.latitude,fp.longitude,
 fp.features,fp.created_at,menu_agg.min_price,menu_agg.max_price,coalesce(menu_agg.menu_count,0) AS menu_count,
 coalesce(coupon_agg.coupon_count,0) AS coupon_count,coalesce(photo_agg.photo_count,0) AS photo_count,
 fp.google_rating,fp.google_review_count,fp.nearest_station,
 coalesce(booking_menu_agg.booking_menu_count,0) AS booking_menu_count,
 coalesce(staff_agg.active_staff_count,0) AS active_staff_count,
 (fp.address IS NOT NULL AND btrim(fp.address)<>'') AS has_address,
 public.published_special_hours(fp.id) AS special_hours,fp.medical_specialties
 FROM public.facility_profiles fp
 LEFT JOIN LATERAL (
  SELECT min(m.price) AS min_price,max(m.price) AS max_price,count(*)::integer AS menu_count
  FROM public.facility_menus m WHERE m.facility_id=fp.id AND m.price IS NOT NULL AND coalesce(m.is_published,true)
 ) menu_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS coupon_count FROM public.coupons c
  WHERE c.facility_id=fp.id AND c.is_active=true
   AND (c.valid_from IS NULL OR c.valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date)
   AND (c.valid_until IS NULL OR c.valid_until>=(now() AT TIME ZONE 'Asia/Tokyo')::date)
 ) coupon_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS photo_count FROM public.facility_photos p WHERE p.facility_id=fp.id
 ) photo_agg ON true
 -- Same counting as checkBookingReadiness: published menus regardless of price.
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS booking_menu_count FROM public.facility_menus m
  WHERE m.facility_id=fp.id AND coalesce(m.is_published,true)
 ) booking_menu_agg ON true
 -- Same counting as checkBookingReadiness: active staff who have working time.
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS active_staff_count FROM public.staff_profiles s
  WHERE s.facility_id=fp.id AND s.is_active AND public.staff_has_working_time(s.id)
 ) staff_agg ON true
 WHERE fp.status='published';

CREATE OR REPLACE FUNCTION search_facilities_nearby(
  user_lat  DOUBLE PRECISION,
  user_lng  DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 10,
  type_filter TEXT DEFAULT NULL,
  limit_count INT DEFAULT 100,
  keyword_filter TEXT DEFAULT NULL,
  features_filter TEXT[] DEFAULT NULL
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
    AND (type_filter IS NULL OR v.business_type = type_filter OR fp.medical_specialties @> ARRAY[type_filter])
    AND (
      keyword_filter IS NULL
      -- 「どの語も外していない」＝全語一致。NOT EXISTS で AND 意味論を表現する。
      -- 🔴 COALESCE 必須: NULL 列があると OR 連鎖が NULL → NOT NULL も NULL となり、
      --    内側 WHERE が行を返さず「一致した」と誤判定される（20260812000001 の欠陥）。
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(keyword_filter, E'[\\s　]+')) AS term
        WHERE term <> ''
          AND NOT (
            COALESCE(v.name, '') ILIKE '%' || term || '%' ESCAPE '\'
            OR COALESCE(v.catch_copy, '') ILIKE '%' || term || '%' ESCAPE '\'
            OR COALESCE(v.description, '') ILIKE '%' || term || '%' ESCAPE '\'
            OR COALESCE(v.city, '') ILIKE '%' || term || '%' ESCAPE '\'
            OR COALESCE(v.access_info, '') ILIKE '%' || term || '%' ESCAPE '\'
            OR COALESCE(fp.nearest_station, '') ILIKE '%' || term || '%' ESCAPE '\'
          )
      )
    )
    -- 非GPS検索(searchFacilities の features ループ)と同じ AND 意味論：
    -- 指定した features を全て含む施設のみ。features_filter が NULL/空なら無条件で真。
    AND (features_filter IS NULL OR fp.features @> features_filter)
  ORDER BY distance_km ASC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION search_facilities_nearby(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, INT, TEXT, TEXT[]
) TO anon, authenticated;

COMMIT;
