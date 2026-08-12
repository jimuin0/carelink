-- -----------------------------------------------------------------------------
-- search_facilities_nearby() のキーワード照合を「複数語 AND」にする。
--
-- 【背景・恒久根治】キーワードを空白で分割せず、入力全体を1つの ILIKE パターン
-- `%豊中 まつげ%` として扱っていたため、その並びを literal に含む施設しか当たらず
-- 【複数語で検索すると常に 0 件】だった。検索は主要導線なので影響が大きい。
-- 本番の実データでも、特集 eyelash-special（filter_type は正しく「ネイル・まつげサロン」で
-- 該当施設が 2 件ある）が filter_keyword「まつ毛 パーマ エクステ」のせいで 0 件だった。
--
-- 非 GPS 経路（src/lib/facilities.ts の keywordTerms + 語ごとの .or()）と同じ意味論に揃える。
-- 片方だけ直すと、2026年7月10日の migration 20260710000001 が解消したはずの
-- 「GPS と非GPS で絞り込み結果が食い違う」非対称を作り直すことになる。
--
-- あわせて access_info を照合列に追加する。非 GPS は 6 列
-- (name / catch_copy / description / city / access_info / nearest_station) を見るのに
-- RPC は access_info だけ見ておらず、アクセス自由記述に書かれた地名・駅名が
-- GPS 検索でだけ当たらない非対称が残っていた（RETURNS TABLE には元から含まれている列）。
--
-- 🔴 全角スペース(U+3000)も区切りに含めること。PostgreSQL の `\s` は U+3000 を含まないため、
--    半角だけで分割すると日本語入力（全角空白混在）で同じ症状が残る。
--
-- 引数の型・並び・戻り値は一切変えない（CREATE OR REPLACE で本文だけ差し替え）。
-- 署名を変えると旧オーバーロードが本番に残留し、20260804000001 で撤去した問題を再発させる。
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
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(keyword_filter, E'[\\s　]+')) AS term
        WHERE term <> ''
          AND NOT (
            v.name ILIKE '%' || term || '%' ESCAPE '\'
            OR v.catch_copy ILIKE '%' || term || '%' ESCAPE '\'
            OR v.description ILIKE '%' || term || '%' ESCAPE '\'
            OR v.city ILIKE '%' || term || '%' ESCAPE '\'
            OR v.access_info ILIKE '%' || term || '%' ESCAPE '\'
            OR fp.nearest_station ILIKE '%' || term || '%' ESCAPE '\'
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
