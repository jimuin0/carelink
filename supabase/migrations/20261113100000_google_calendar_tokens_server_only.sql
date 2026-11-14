-- 点検 A104（2026年11月13日）：google_calendar_tokens（Google の access_token / refresh_token）を service_role 専用にする。
--
-- アプリの読み書きは src/app/api/google-calendar/route.ts・callback/route.ts・sync/route.ts の 3 本で、
-- すべて createServiceRoleClient()（RLS バイパス）経由。ブラウザ（anon / authenticated）のクライアントで
-- この表を読む箇所は src・e2e に 1 つも無い（grep で確認済み）。にもかかわらず authenticated に表の SELECT 権と
-- 「自分の行は全操作可（cmd=*・roles=PUBLIC）」のポリシー gcal_tokens_own が残っており、ログインした本人の
-- ブラウザ（＝XSS や拡張機能を含む）から refresh_token を素で読めた。
--
-- RLS は有効のまま・許可ポリシー無し＝service_role のみ（threads_credentials と同じ形）。
-- 適用順序：コード変更なし。いつ適用してもよい（1 段目）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

REVOKE ALL ON public.google_calendar_tokens FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS gcal_tokens_own ON public.google_calendar_tokens;
ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;
