-- 点検 B7-3（2026年11月13日）：cron_logs の閲覧ポリシーを profiles.role='admin' から is_platform_admin に揃える。
--
-- プラットフォーム管理者の判定は profiles.is_platform_admin（src/lib/platform-admin.ts の requirePlatformAdmin）
-- に一本化されている。cron_logs_admin_read だけが旧来の profiles.role='admin' を見ており、
-- 運営の監視画面 /admin/cron-monitor（ブラウザから読む）と判定がずれていた。
-- 適用順序：コード変更なし。いつ適用してもよい（1 段目）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DROP POLICY IF EXISTS cron_logs_admin_read ON public.cron_logs;
CREATE POLICY cron_logs_admin_read ON public.cron_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = (SELECT auth.uid()) AND p.is_platform_admin IS TRUE
  ));
