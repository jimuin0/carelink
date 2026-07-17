-- ============================================================================
-- get_facility_customers_v1 の authenticated EXECUTE を撤回し service_role 限定にする
-- ============================================================================
-- 【背景】20260626000006 で新設した本関数は LANGUAGE sql STABLE（SECURITY INVOKER が既定・
-- SECURITY DEFINER ではない）で、定義コメント自身が「本 API は service_role から呼ぶ」と
-- 明記している。にもかかわらず末尾の GRANT が `TO authenticated, service_role` となっており、
-- 実際には使われない authenticated への EXECUTE 権が残存していた。
--
-- 【調査結果（2026年7月17日・読み取り専用調査で確定）】唯一の呼び出し元
-- src/app/api/v1/customers/route.ts は createServiceRoleClient() のみを使用（外部APIキー認証・
-- Supabase Auth セッションを介さない）。src/app/api/v1/customers/__tests__/route.test.ts も
-- createServiceRoleClient のみをモック。e2e/・scripts/・ブラウザ経由（supabase-browser.ts）に
-- authenticated 文脈での呼び出しは皆無（grep 全数調査済み）。
--
-- 本関数は bookings.customer_name/phone/email という個人情報を facility_id 限定とはいえ
-- 返すため、不要な authenticated EXECUTE 権を残す意味がない（最小権限原則）。
-- 20260605000001・20260704000002 と同一の恒久対策パターンを踏襲する：
-- service_role への明示 GRANT を先に冪等発行してから PUBLIC/anon/authenticated を REVOKE。
-- 冪等（GRANT/REVOKE とも何度実行しても安全）。
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_facility_customers_v1(UUID, TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION get_facility_customers_v1(UUID, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
