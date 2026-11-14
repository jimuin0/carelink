-- blog_posts / treatment_catalogs のメンバー用ポリシーを owner/admin の読み取りに絞る（2026年11月14日・点検 A283）。
--
-- 定義元: supabase/migrations/combined_phase2_to_6.sql（および 20260323000005_phase6_advanced.sql）の
--   blog_posts_member_all / treatment_catalogs_member_all。FOR ALL で「その施設のメンバーか」しか見ず、
--   ロールを owner/admin に絞っていなかった。テーブル GRANT も既定のまま残っていたため、
--   staff でも PostgREST から自店舗のブログ記事・施術カタログを作成・改変・削除できた。
--
-- アプリの書き込みは /api/admin/blog・/api/admin/catalog → manage_admin_content_atomic（service_role）だけで、
-- ブラウザ（authenticated）からの読み取りは管理画面（owner/admin のみ）の下書き表示だけ。
-- 公開読み（blog_posts_published_read / treatment_catalogs_public_read）はそのまま。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.blog_posts, public.treatment_catalogs
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "blog_posts_member_all" ON public.blog_posts;
DROP POLICY IF EXISTS "blog_posts_member_read" ON public.blog_posts;
CREATE POLICY "blog_posts_member_read" ON public.blog_posts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.facility_members fm
    WHERE fm.facility_id = blog_posts.facility_id
      AND fm.user_id = (SELECT auth.uid())
      AND fm.role IN ('owner', 'admin')
  ));

DROP POLICY IF EXISTS "treatment_catalogs_member_all" ON public.treatment_catalogs;
DROP POLICY IF EXISTS "treatment_catalogs_member_read" ON public.treatment_catalogs;
CREATE POLICY "treatment_catalogs_member_read" ON public.treatment_catalogs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.facility_members fm
    WHERE fm.facility_id = treatment_catalogs.facility_id
      AND fm.user_id = (SELECT auth.uid())
      AND fm.role IN ('owner', 'admin')
  ));
