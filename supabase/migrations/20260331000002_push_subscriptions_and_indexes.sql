-- ============================================================
-- CareLink: push_subscriptions テーブル + パフォーマンスインデックス
-- 実行: Supabase Dashboard > SQL Editor でこのファイルを貼り付けて実行
-- ============================================================

-- ============================================================
-- 1. push_subscriptions テーブル（既に存在する場合はスキップ）
-- ============================================================
-- 【スキーマ権威に関する重要注記 2026-06-02】
--   本番 DB の push_subscriptions の真実は、辞書順で先行する
--   20260330_phase_c_infra.sql 由来の「id UUID PRIMARY KEY + user_id UNIQUE +
--   created_at 有り」版である（2026-06-02 の本番 introspection / database.types.ts で
--   id・created_at 列の存在を確認済み）。
--   下の CREATE TABLE は「user_id PRIMARY KEY・id/created_at 欠落」という異なる定義だが、
--   IF NOT EXISTS のため既存テーブルに対しては no-op（列追加もしない）。
--   replay 時も 20260330 が必ず先に走って id PK 版を作るため、本ブロックは常に no-op となり
--   本番と一致する。PK 構造を ALTER で変更してはならない（本番稼働中・データ移行リスク）。
--   = ここの列定義は歴史的経緯による不一致だが実害は無く、恒久的に no-op であることを明記する。
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ポリシー（既存なら再作成）
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can manage own push subscription" ON push_subscriptions;
  DROP POLICY IF EXISTS "Service role full access" ON push_subscriptions;
END $$;

CREATE POLICY "Users can manage own push subscription"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON push_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 2. パフォーマンスインデックス（既存テーブル）
-- ============================================================

-- facility_profiles: 検索・一覧の高速化
CREATE INDEX IF NOT EXISTS idx_fp_status ON facility_profiles(status);
CREATE INDEX IF NOT EXISTS idx_fp_slug_status ON facility_profiles(slug, status);
CREATE INDEX IF NOT EXISTS idx_fp_business_type_status ON facility_profiles(business_type, status);
CREATE INDEX IF NOT EXISTS idx_fp_prefecture_status ON facility_profiles(prefecture, status);
CREATE INDEX IF NOT EXISTS idx_fp_city_status ON facility_profiles(city, status);
CREATE INDEX IF NOT EXISTS idx_fp_rating_avg_desc ON facility_profiles(rating_avg DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_fp_view_count_desc ON facility_profiles(view_count DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_fp_rating_count_desc ON facility_profiles(rating_count DESC NULLS LAST) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_fp_created_at_desc ON facility_profiles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fp_features_gin ON facility_profiles USING GIN(features);

-- bookings: 予約検索・空き枠確認の高速化
CREATE INDEX IF NOT EXISTS idx_bookings_facility_date_status ON bookings(facility_id, booking_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date ON bookings(staff_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);

-- favorites: ユーザーお気に入り
CREATE INDEX IF NOT EXISTS idx_favorites_user_facility ON favorites(user_id, facility_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);

-- staff_profiles
CREATE INDEX IF NOT EXISTS idx_staff_facility_active ON staff_profiles(facility_id, is_active);

-- facility_menus
CREATE INDEX IF NOT EXISTS idx_menus_facility ON facility_menus(facility_id);

-- facility_photos
CREATE INDEX IF NOT EXISTS idx_photos_facility ON facility_photos(facility_id);

-- facility_reviews
CREATE INDEX IF NOT EXISTS idx_reviews_facility_status ON facility_reviews(facility_id, status);

-- coupons
CREATE INDEX IF NOT EXISTS idx_coupons_facility_active ON coupons(facility_id, is_active);

-- blog_posts
CREATE INDEX IF NOT EXISTS idx_blog_facility_published ON blog_posts(facility_id, is_published);

-- staff_schedules
CREATE INDEX IF NOT EXISTS idx_schedules_staff ON staff_schedules(staff_id);

-- schedule_overrides
CREATE INDEX IF NOT EXISTS idx_overrides_date_staff ON schedule_overrides(date, staff_id);

-- customer_visits
CREATE INDEX IF NOT EXISTS idx_visits_facility_date ON customer_visits(facility_id, visit_date DESC);
