-- 点検 B7-20（2026年11月13日）：api_keys.key_hash をブラウザ（authenticated）から読めなくする。
--
-- key_hash は外部 API（/api/v1/*）の Bearer キーの SHA-256。照合はサーバーの service_role だけが行う
-- （src/app/api/v1/bookings/route.ts・customers/route.ts）。管理画面 /admin/api-keys は
-- 'id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at' を明示列で読み、
-- key_hash を選んでいない（src/app/admin/api-keys/page.tsx）。発行・失効は /api/admin/api-keys（service_role の RPC）。
--
-- 🔴 RLS は列を絞れないので、表単位の SELECT を外して key_hash 以外を列単位で付け直す
-- （表単位の SELECT が残っている限り、列の REVOKE は効かない）。
-- 🔴 以後 api_keys に列を足したら、画面で読む列は authenticated へ
--    GRANT SELECT (新しい列) ON public.api_keys TO authenticated; を同じ migration に書くこと
--    （書かないと画面の select が 42501 で落ちる）。
-- 適用順序：コード変更なし。いつ適用してもよい（1 段目）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DO $cols$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.api_keys'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'key_hash';
  IF cols IS NULL THEN RAISE EXCEPTION 'api_keys has no columns to grant'; END IF;
  REVOKE SELECT ON public.api_keys FROM PUBLIC, anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.api_keys TO authenticated', cols);
END $cols$;
