-- 点検 B9-1（2026年11月13日）：facility_profiles.stripe_account_id（Stripe Connect の接続先）を anon / authenticated から読めなくする。
--
-- facility_profiles は公開施設の行を誰でも読める（RLS は行を絞るだけで列は絞れない）ため、
-- 表単位の SELECT 権がある限り、未ログインでも PostgREST から stripe_account_id を読めた。
-- stripe_account_id を読むのは /api/stripe/checkout（service_role）だけ。
--
-- 🔴 表単位の SELECT が残っている限り列の REVOKE は効かないので、表単位の SELECT を外し、
--    stripe_account_id 以外の列を列単位で付け直す（列は適用時点の実在列から機械的に作る）。
-- 🔴 列単位 GRANT の下では select('*') が 42501 になる。アプリ側の select('*') 2 箇所
--    （src/lib/facilities.ts の getFacilityBySlug・src/app/admin/settings/page.tsx）は同日に
--    src/lib/facility-profile-columns.ts の明示列へ直した。src/__tests__/facility-profile-columns.test.ts が
--    select('*') の再混入と列一覧の漏れを CI で止める。
-- 🔴🔴 今後 facility_profiles に列を足すときは、その migration に必ず
--    GRANT SELECT (新しい列) ON public.facility_profiles TO anon, authenticated;
--    を書き、src/lib/facility-profile-columns.ts にも足すこと（書かないと公開ページ・店舗画面から新しい列が読めない）。
-- 書き込み権（INSERT / UPDATE 等）とポリシーは変更しない。security_invoker のビュー facility_card_view は
-- stripe_account_id を射影していないので影響しない。
--
-- 🔴 適用順序：【コードの配信の後】に適用する（2 段目）。旧コードの select('*') は適用した瞬間に施設ページと
--    店舗の設定画面を壊す。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DO $cols$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.facility_profiles'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'stripe_account_id';
  IF cols IS NULL THEN RAISE EXCEPTION 'facility_profiles has no columns to grant'; END IF;
  REVOKE SELECT ON public.facility_profiles FROM PUBLIC;
  REVOKE SELECT ON public.facility_profiles FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.facility_profiles TO anon, authenticated', cols);
END $cols$;
