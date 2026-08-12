-- -----------------------------------------------------------------------------
-- search_facilities_nearby() のキーワード照合を NULL 安全にする。
--
-- 🔴 【20260812000001 が持ち込んだ欠陥・本番で実測】複数語 AND 判定を
--   NOT EXISTS (… WHERE term <> '' AND NOT (col ILIKE … OR col ILIKE … ))
-- で書いたが、6列のうち1つでも NULL があると OR 連鎖が NULL になり、NOT NULL も NULL、
-- 内側の WHERE が NULL の行を返さないため【その語は一致した】と誤判定される。
-- 結果、**どれか1列でも NULL の施設は、どんなキーワードにも一致する**。
--
-- 本番の実測（2026年8月12日）: 現在地(34.7706,135.4532) キーワード「豊中 鍼灸」で
-- 鍼灸院に加えてまつげサロン2店が返っていた（当該2店は照合列に NULL を含む）。
--
-- 【なぜ元の実装では起きなかったか】旧版は WHERE 直下の
--   keyword_filter IS NULL OR col ILIKE … OR col ILIKE …
-- という形で、NULL は WHERE が偽として扱うため【取りこぼす側】に倒れていた。
-- NOT EXISTS へ移した際に NULL の倒れる向きが反転し、偽陽性へ変わった。
--
-- 非 GPS 経路（PostgREST の .or(...)）は WHERE 直下の OR のままなので影響を受けない。
-- COALESCE で NULL を空文字に倒し、両経路の意味論を揃える。
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
