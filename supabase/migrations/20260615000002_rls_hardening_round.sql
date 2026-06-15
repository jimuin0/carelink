-- ============================================================================
-- RLS hardening round (2026-06-15)
-- 読み取り専用 RLS 監査で確定した policy/grant/view の構造欠陥を恒久修正する。
-- 既存 migration は無改変。本ファイルで現行の有効状態のみを是正する（drift 防止）。
-- 全 4 項目ともアプリ副作用ゼロを grep/Read で事前確定済み:
--   (1) contact_replies … src 未使用（参照は型定義のみ）
--   (2) platform_blog   … API は service_role 経由＋is_platform_admin 判定（RLS バイパス）
--   (3) facility_card_view … facilities.ts は全クエリ status='published' 固定・draft 取得なし
--   (4) bookings        … 直接 INSERT 箇所なし・予約は create_booking_atomic(SECURITY DEFINER) 経由
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) contact_replies: クロステナント IDOR の是正（service_role 限定化）
--   旧 policy "contact_replies_facility_member" は EXISTS サブクエリで contacts と
--   facility_members を相関させておらず（fm.user_id=auth.uid() のみ）、「いずれかの施設に
--   所属する authenticated ユーザー」が全 contact_replies（顧客返信本文・内部メモ）を
--   FOR ALL で読み書き可能だった。contacts は運営宛 /contact 問い合わせで施設に紐付かない。
--   既存 sent_reminders と同一の RESTRICTIVE 全拒否に統一し、操作は service_role のみに限定。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "contact_replies_facility_member" ON contact_replies;
CREATE POLICY "no_access" ON contact_replies
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

-- ----------------------------------------------------------------------------
-- (2) platform_blog_posts: 書込 policy を is_platform_admin 限定に是正
--   旧 policy "platform_blog_admin_all" は施設相関を欠き「いずれかの施設の owner/admin」に
--   運営ブログ（プラットフォーム横断コンテンツ）の作成/編集/削除を許可していた。
--   他の platform 系と同様 profiles.is_platform_admin のみに限定する。
--   公開記事の SELECT policy "platform_blog_public_read"（status='published'）は無改変。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "platform_blog_admin_all" ON platform_blog_posts;
CREATE POLICY "platform_blog_admin_all" ON platform_blog_posts FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_platform_admin = true
  )
);

-- ----------------------------------------------------------------------------
-- (3) facility_card_view: status='published' フィルタを追加
--   VIEW は security definer 相当（security_invoker 未指定）で facility_profiles の RLS を
--   バイパスし、anon に draft/pending 施設のカード情報まで露出していた。
--   列構成・集計は drift_repair(20260602000003) の定義を厳密に踏襲し、末尾に WHERE のみ追加
--   （CREATE OR REPLACE の列順・型を一致させ、本番ビューと無矛盾に置換）。
--   集計 JOIN は引き続き definer 権限で評価され published 施設の menu/coupon/photo 集計は不変。
-- ----------------------------------------------------------------------------
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
) photo_agg ON true
WHERE fp.status = 'published';

GRANT SELECT ON facility_card_view TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- (4) bookings: 宙に浮いた anon/authenticated への INSERT grant を撤去
--   INSERT policy は 20260608000001 で DROP 済みで現状 client 直 INSERT は不能だが、
--   20260406000001 の GRANT INSERT ON bookings TO anon, authenticated が REVOKE されず残存し、
--   将来 INSERT policy が再付与されると即 anon 直 INSERT が開く地雷だった。
--   予約は create_booking_atomic(SECURITY DEFINER) 経由で INSERT するため REVOKE の副作用なし。
-- ----------------------------------------------------------------------------
REVOKE INSERT ON bookings FROM anon, authenticated;
