-- 点検 B9-10（2026年11月14日）：search_facilities_nearby の件数上限が呼び出し側任せだった。
--
-- anon / authenticated に EXECUTE があり、limit_count に NULL を渡すと LIMIT NULL＝件数無制限、巨大値でも同じになる。
-- 上限を 500（アプリが渡している値）に固定し、NULL は既定の 100、負数は 0 件にする。
-- 写し元: 20261030014653_search_medical_specialties.sql（全文。LIMIT 句だけを置換）。
-- 🔴 CREATE OR REPLACE は proconfig も置き換えるので、20261104120000 の search_path 固定を SET で書き直している。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.search_facilities_nearby(
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
SET search_path = public, extensions, pg_temp
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
  -- 呼び出し側（anon）が NULL や巨大値を渡しても件数を無制限にしない。アプリは 500 を渡している（src/lib/facilities.ts）。
  LIMIT least(greatest(coalesce(limit_count, 100), 0), 500);
$$;
