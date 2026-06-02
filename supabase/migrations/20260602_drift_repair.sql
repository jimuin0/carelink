-- =============================================================================
-- 20260602 Drift Repair — 本番スキーマと repo migration の乖離を一括解消
-- =============================================================================
-- 2026-06-02 ライブプローブ（tests/contract/rpc-probe.test.ts）で本番 public
-- スキーマを実測した結果、過去 migration が out-of-band 適用された影響で以下が
-- 本番に欠落していることを確定した（推測ではなく PGRST202 / 42703 / PGRST205 の
-- 実エラーで確認）:
--
--   1. facility_card_view に google_rating / google_review_count 列が無い
--      → 20260417_google_rating_columns.sql / 20260417_materialized_card_view.sql 未適用
--   2. search_facilities_nearby() 関数が無い（GPS 検索が動作しない）
--      → 20260417_postgis.sql の RPC 部分が未適用
--   3. facility_reviews に reviewer_ip / is_flagged / flag_reason 列が無い
--      → 20260417_review_flagging.sql 未適用（cron/flag-reviews が常時失敗）
--   4. slack_incident_threads テーブル + get/record_incident_thread 関数が無い
--      → 20260526_slack_incident_threads.sql 未適用
--   5. find_bulk_review_ips() 関数が repo にも本番にも存在しない
--      → cron/flag-reviews が呼ぶが migration が一度も書かれていなかった（恒久新規定義）
--   6. public_reviews ビューが無い + facility_reviews の公開/anon-insert ポリシー残存
--      → 20260420_public_reviews_view.sql が存在しない user_id 列を参照して CREATE VIEW
--        失敗 → トランザクション全ロールバックで ①ビュー未作成 ②DROP POLICY 未実行 の
--        二重ドリフト。公開レビュー表示（ReviewTab / lib/facilities）が壊れていた。
--      → 20260420_reviews_anon_insert_rls.sql / reviews_ip_protection.sql も未適用
--   7. trg_sync_facility_location トリガが無い（座標更新で location 不同期 → GPS ズレ）
--      → 20260417_postgis.sql の trigger 部のみ未適用
--   8. referral_codes に "Public read codes"(USING true) が残存
--      → 20260420_referral_uses_rls.sql 未適用（紹介コード全公開）
--
-- 本 migration は全て IF NOT EXISTS / CREATE OR REPLACE / IF EXISTS で冪等。
-- 既に正しい本番には無害（再適用安全）。
--
-- 【本 migration の適用前後で実測検証する手順】
--   適用前 → 適用後 で tests/contract/rpc-probe.test.ts を再実行し全項目解消を確認、
--   かつ本番 public スキーマの introspection dump を再取得して差分ゼロを確認する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (A) facility_profiles の Google 口コミ列（search_facilities_nearby / view の前提）
-- -----------------------------------------------------------------------------
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS google_rating       NUMERIC(2,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_review_count INTEGER      DEFAULT 0;

-- -----------------------------------------------------------------------------
-- (B) facility_card_view に google 列を追加（CREATE OR REPLACE で末尾追記）
--     本番は phase_c_infra 由来の「素の VIEW」（google 列なし・24 列）。
--     2026-06-02 ライブ実測で本番の現行カラム順を確定:
--       1.id 2.slug 3.name 4.business_type 5.catch_copy 6.description 7.prefecture
--       8.city 9.access_info 10.rating_avg 11.rating_count 12.main_photo_url
--       13.business_hours 14.seat_count 15.status 16.latitude 17.longitude
--       18.features 19.created_at 20.min_price 21.max_price 22.menu_count
--       23.coupon_count 24.photo_count
--     ※ CREATE OR REPLACE VIEW は「既存列を同名・同順で維持し、新列は末尾追記のみ」
--       が制約。google 列を中間に差し込むと 42P16（列名変更不可）で失敗するため、
--       既存 24 列の順序を厳密に踏襲し google_rating / google_review_count を 25・26
--       列目として末尾に追記する。RPC(search_facilities_nearby) も frontend(CARD_COLS)
--       も列を「名前」で参照するため、末尾追記による順序差は無影響。
--     ※ matview 化（20260417_materialized_card_view.sql / v8.29）は採用しない:
--       書き込み毎の REFRESH トリガが write-path に副作用・失敗リスクを足すため、
--       本番が現に依存している素 VIEW セマンティクスを維持する（確実性優先）。
-- -----------------------------------------------------------------------------
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
  fp.google_review_count
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

-- -----------------------------------------------------------------------------
-- (C) search_facilities_nearby() — PostGIS GPS 検索 RPC（20260417_postgis.sql と同一定義）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- (D) facility_reviews 不正検知列（20260417_review_flagging.sql）
-- -----------------------------------------------------------------------------
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS reviewer_ip TEXT,
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reviews_ip ON facility_reviews(reviewer_ip)
  WHERE reviewer_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON facility_reviews(is_flagged)
  WHERE is_flagged = TRUE;

-- reviewer_ip(PII) を一般 authenticated 読み取りから隠す（20260420_reviews_ip_protection.sql）
-- USING(true) の広すぎる auth_read_reviews を施設メンバー限定に差し替え。冪等化のため再作成。
DROP POLICY IF EXISTS "auth_read_reviews" ON facility_reviews;
DROP POLICY IF EXISTS "facility_reviews_member_read" ON facility_reviews;
CREATE POLICY "facility_reviews_member_read" ON facility_reviews
  FOR SELECT TO authenticated
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- anon 直 INSERT を塞ぐ（20260420_reviews_anon_insert_rls.sql）。
-- 全レビュー投稿は POST /api/review（service_role）経由。直 INSERT は reCAPTCHA /
-- レート制限 / reviewer_ip 記録 / 重複チェック / CSRF を全て迂回するため廃止。
DROP POLICY IF EXISTS "Anyone can insert reviews" ON facility_reviews;

-- -----------------------------------------------------------------------------
-- (D2) public_reviews ビュー（20260420_public_reviews_view.sql の根本修正版）
--   原本は存在しない user_id 列を SELECT していたため CREATE VIEW が 42703 で失敗し、
--   ① public_reviews 未作成（PGRST205）② 同 migration 末尾の DROP POLICY 未実行
--   （anon が facility_reviews を直 SELECT 可能なまま = reviewer_ip 露出予備軍）
--   という二重ドリフトを起こしていた。2026-06-02 ライブ実測で確定:
--     - GET /rest/v1/public_reviews            → 404 PGRST205（ビュー無し）
--     - GET /rest/v1/facility_reviews (anon)   → 200 + rows（直読み可能）
--     - facility_reviews.user_id               → 400（列が存在しない）
--   user_id を除いた正しい定義で再作成する。公開読み取り経路（ReviewTab.tsx /
--   lib/facilities.ts:getFacilityReviews）は既に public_reviews を参照しており、
--   select('*') のみで user_id に依存しないため無影響。
CREATE OR REPLACE VIEW public_reviews
  WITH (security_invoker = false)  -- SECURITY DEFINER 相当（所有者=postgres 権限で実行）
AS
  SELECT
    id,
    facility_id,
    reviewer_name,
    rating,
    rating_skill,
    rating_service,
    rating_atmosphere,
    rating_cleanliness,
    rating_explanation,
    comment,
    photo_urls,
    is_verified_visit,
    status,
    created_at
  FROM facility_reviews
  WHERE status = 'published';

GRANT SELECT ON public_reviews TO anon, authenticated;

-- public_reviews 導入後、anon の facility_reviews 直 SELECT ポリシーを撤去。
-- anon は published のみ・reviewer_ip を含まない public_reviews 経由で読む。
DROP POLICY IF EXISTS "Public read published reviews" ON facility_reviews;

-- -----------------------------------------------------------------------------
-- (E) find_bulk_review_ips() — cron/flag-reviews が呼ぶが migration 未定義だった恒久新規
--     同一 IP から p_since 以降に p_threshold 件以上投稿した IP を返す。
--     src/app/api/cron/flag-reviews/route.ts: { p_since, p_threshold } → row.reviewer_ip
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_bulk_review_ips(
  p_since     TIMESTAMPTZ,
  p_threshold INT
)
RETURNS TABLE(reviewer_ip TEXT) AS $$
  SELECT fr.reviewer_ip
  FROM facility_reviews fr
  WHERE fr.created_at >= p_since
    AND fr.reviewer_ip IS NOT NULL
  GROUP BY fr.reviewer_ip
  HAVING COUNT(*) >= p_threshold;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION find_bulk_review_ips(TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_bulk_review_ips(TIMESTAMPTZ, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- (F) slack_incident_threads テーブル + 関数（20260526_slack_incident_threads.sql）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_incident_threads (
  thread_key  TEXT PRIMARY KEY,
  channel     TEXT NOT NULL,
  thread_ts   TEXT NOT NULL,
  event_count INT  NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_slack_threads_expires
  ON slack_incident_threads (expires_at);

CREATE OR REPLACE FUNCTION get_incident_thread(p_key TEXT)
RETURNS TABLE(channel TEXT, thread_ts TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT t.channel, t.thread_ts
  FROM slack_incident_threads t
  WHERE t.thread_key = p_key AND t.expires_at > NOW()
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION record_incident_thread(
  p_key       TEXT,
  p_channel   TEXT,
  p_thread_ts TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO slack_incident_threads (thread_key, channel, thread_ts)
  VALUES (p_key, p_channel, p_thread_ts)
  ON CONFLICT (thread_key) DO UPDATE
  SET event_count = slack_incident_threads.event_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION get_incident_thread(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incident_thread(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- (G) facility_profiles.location 自動同期トリガ（20260417_postgis.sql の trigger 部）
--     本番には location 列・GiST インデックス・search_facilities_nearby は載ったが、
--     lat/lng 更新時に location を再計算する trg_sync_facility_location が欠落していた
--     （ライブdump の TRG 一覧に不在を確認）。これが無いと施設が座標を更新しても
--     location が古いまま → GPS 検索結果がズレる/欠ける。冪等再作成する。
-- -----------------------------------------------------------------------------
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

-- トリガ欠落期間中に lat/lng が更新された行の location を一括是正（冪等・副作用なし）。
UPDATE facility_profiles
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND (
    location IS NULL
    OR location IS DISTINCT FROM ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  );

-- -----------------------------------------------------------------------------
-- (H) referral_codes の公開読み取りポリシー撤去（20260420_referral_uses_rls.sql）
--     "Public read codes" (USING true) は紹介コードを anon に全公開してしまうため
--     撤去するのが repo の確定意図。本番に残存していた（dump POL 一覧で確認、現状
--     テーブルは 0 行のため実害は未発生だが完璧基準で恒久撤去）。
--     正規ポリシー（own_select / own_insert）は 20260405_referral_program.sql 由来で存置。
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read codes" ON referral_codes;
