-- PostGIS移行: GPS検索をDB側で実行
-- haversine JS計算から ST_DWithin に変更

CREATE EXTENSION IF NOT EXISTS postgis;

-- 既存のlatitude/longitudeカラムから geography(POINT) カラムを追加
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS location geography(POINT, 4326);

-- 既存データをマイグレーション
UPDATE facility_profiles
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- 空間インデックス
CREATE INDEX IF NOT EXISTS idx_facility_profiles_location
  ON facility_profiles USING GIST (location);

-- トリガー: latitude/longitude が更新されたら location を自動更新
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

-- RPC: 近隣施設検索（PostGIS）
-- radius_km: 検索半径（km）
-- 戻り値: facility_card_view の全カラム + distance_km
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
