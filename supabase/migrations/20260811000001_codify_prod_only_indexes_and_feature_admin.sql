-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- PART 1: 本番にだけ存在していたパフォーマンスインデックス 15 本を migration へ取り込む（2026-08-11）
-- ============================================================================
-- 【発見経緯】本番DBとshadow（全 migration 適用済みDB）を pg_indexes で突合した結果、
--   本番には実在するのに、どの migration にも定義されていないインデックスが 15 本見つかった。
--
-- 【実害】これら 15 本は本番で実際にクエリを高速化している物理最適化なのに、CI の
--   fresh-apply DB や shadow DB にはこの最適化が【存在しない】。fresh-apply が本番と
--   別物の実行計画で検証され続けることになる。
--
-- 【本番への影響】15 本とも本番には既に存在する。IF NOT EXISTS を使うため、本番へ
--   このファイルを適用しても実質 no-op（何も変更しない）。真の狙いは CI/fresh-apply
--   側にこの最適化を追加し、本番と同じ状態で検証できるようにすること。
--
-- 【定義は本番 introspection の実測値をそのまま使用】
--   USING btree の列順・WHERE 句・ARRAY 比較の形を本番と一字一句同じにする。
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled ON public.blog_posts USING btree (facility_id, scheduled_at) WHERE (is_published = true);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent ON public.bookings USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bookings_status_updated ON public.bookings USING btree (status, updated_at) WHERE (status = ANY (ARRAY['cancelled'::text, 'completed'::text]));
CREATE INDEX IF NOT EXISTS idx_facility_menus_facility_price ON public.facility_menus USING btree (facility_id, price);
CREATE INDEX IF NOT EXISTS idx_facility_menus_facility_sort ON public.facility_menus USING btree (facility_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_facility_photos_facility_sort ON public.facility_photos USING btree (facility_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_facility_profiles_city ON public.facility_profiles USING btree (city);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_booking_id ON public.facility_reviews USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_facility_created ON public.facility_reviews USING btree (facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_staff_id ON public.facility_reviews USING btree (staff_id);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_user_id ON public.facility_reviews USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_platform_admin ON public.profiles USING btree (id) WHERE (is_platform_admin = true);
CREATE INDEX IF NOT EXISTS idx_user_packages_package ON public.user_packages USING btree (package_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan ON public.user_subscriptions USING btree (plan_id);
CREATE INDEX IF NOT EXISTS idx_webhook_retry_processing ON public.webhook_retry_queue USING btree (claimed_at) WHERE (status = 'processing'::text);

-- ============================================================================
-- PART 2: feature_articles 管理者向け読み取りポリシーを追加する（2026-08-11）
-- ============================================================================
-- why: プラットフォーム管理者が公開前後を問わず全 feature_articles 行を閲覧・操作できる
--   ようにする。既存の "feature_articles_public_read"（公開済みのみ・一般ユーザー向け）
--   はそのまま維持し、本ポリシーは管理画面からの参照・下書き確認用に追加する。
-- when: profiles.is_platform_admin = true でない限り本ポリシーは適用対象を許可しない
--   （既存の public_read ポリシーが RLS の OR 結合で並立するため、一般ユーザーの閲覧は
--   従来どおり公開済み行のみに制限される）。
DROP POLICY IF EXISTS "feature_articles_platform_admin" ON feature_articles;
CREATE POLICY "feature_articles_platform_admin" ON feature_articles
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_platform_admin = true));

-- ============================================================================
-- PART 3: idx_bookings_staff_date_active の cancel_fee_paid 除外は本ファイルでは扱わない
-- ============================================================================
-- 🔴 本番はこのインデックスを既に cancel_fee_paid を除外した形で持っている（本番が新しい）。
--   このファイルで新しく CREATE INDEX を書いて上書きするのではなく、単一の定義元である
--   supabase/migrations/20260328000001_performance_indexes.sql の CREATE INDEX 文自体を
--   直接書き換えて収斂させる（同一インデックス名の定義がリポジトリ内に複数箇所に散らばる
--   ことを避けるため）。詳細は当該ファイルのコメントを参照。
