-- =============================================
-- Phase C: インフラ整備 (2026-03-30)
-- push_subscriptions / facility_card_view / 追加インデックス
-- =============================================

-- =============================================
-- 1. push_subscriptions テーブル
-- =============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 本人のみ読み書き可能
CREATE POLICY "push_subscriptions_own_select" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "push_subscriptions_own_insert" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "push_subscriptions_own_update" ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "push_subscriptions_own_delete" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- =============================================
-- 2. facility_card_view（検索一覧用マテリアライズドビュー）
-- =============================================
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
  COALESCE(photo_agg.photo_count, 0) AS photo_count
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

-- ビューにRLSは不要（ベーステーブルのRLSが適用される）
-- ただしanonからの読み取りを許可するためGRANTが必要
GRANT SELECT ON facility_card_view TO anon, authenticated;

-- =============================================
-- 3. 追加インデックス（既存にないもの）
-- =============================================

-- slug検索用（staff_profiles, areas, features）
CREATE INDEX IF NOT EXISTS idx_staff_profiles_slug ON staff_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_areas_slug ON areas(slug);
CREATE INDEX IF NOT EXISTS idx_features_slug ON features(slug) WHERE is_published = true;

-- 予約の複合インデックス（管理画面分析用）
CREATE INDEX IF NOT EXISTS idx_bookings_facility_status_date
  ON bookings(facility_id, status, booking_date DESC);

-- ユーザーの予約一覧用
CREATE INDEX IF NOT EXISTS idx_bookings_user_date
  ON bookings(user_id, booking_date DESC);

-- クーポン取得用（is_active フィルタ付き）
CREATE INDEX IF NOT EXISTS idx_coupons_facility_active
  ON coupons(facility_id, sort_order) WHERE is_active = true;

-- coupon_menus のmenu_id検索用
CREATE INDEX IF NOT EXISTS idx_coupon_menus_menu ON coupon_menus(menu_id);

-- customer_visits の複合インデックス
CREATE INDEX IF NOT EXISTS idx_customer_visits_facility_date
  ON customer_visits(facility_id, visit_date DESC);

-- facility_profiles の検索用複合インデックス
CREATE INDEX IF NOT EXISTS idx_fp_search_type_pref
  ON facility_profiles(business_type, prefecture) WHERE status = 'published';

-- blog_posts の公開記事用
CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON blog_posts(facility_id, published_at DESC) WHERE is_published = true;
