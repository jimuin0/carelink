-- -----------------------------------------------------------------------------
-- search_facilities_nearby() に keyword_filter / features_filter を追加する。
--
-- 【背景・恒久根治】GPS 検索（isGeoSearch=true 分岐・src/lib/facilities.ts）は
-- PostGIS RPC search_facilities_nearby を経由するが、RPC が type_filter しか
-- 受け付けないため、非 GPS 検索では効いている keyword / features フィルタ指定が
-- GPS 検索では黙って無視されていた（コード自身のコメントで既知の未解決課題として
-- 明記されていた）。GPS 検索でキーワードや設備条件を指定しても絞り込まれない
-- ＝来院者の検索意図が構造的に無視される確定欠陥。
--
-- RPC が返す facility_card_view には description / features はあるが
-- nearest_station は無い（非GPS検索は city.ilike / nearest_station.ilike も見る）ため、
-- RPC 内で facility_profiles fp を追加参照して nearest_station も対象にする。
-- -----------------------------------------------------------------------------

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
    AND (type_filter IS NULL OR v.business_type = type_filter)
    AND (
      keyword_filter IS NULL
      OR v.name ILIKE '%' || keyword_filter || '%' ESCAPE '\'
      OR v.catch_copy ILIKE '%' || keyword_filter || '%' ESCAPE '\'
      OR v.description ILIKE '%' || keyword_filter || '%' ESCAPE '\'
      OR v.city ILIKE '%' || keyword_filter || '%' ESCAPE '\'
      OR fp.nearest_station ILIKE '%' || keyword_filter || '%' ESCAPE '\'
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
