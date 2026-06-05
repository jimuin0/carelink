-- =============================================================================
-- service_role 限定 SECURITY DEFINER 関数から anon / authenticated の EXECUTE を明示撤回
-- =============================================================================
-- 【背景・事実】Supabase の既定 default privileges（pg_default_acl: postgres|public|
-- {...anon=X...,authenticated=X...}）が public スキーマの全関数に anon / authenticated の
-- EXECUTE を自動付与する。そのため各関数定義側の `REVOKE ALL ON FUNCTION <f> FROM PUBLIC`
-- は「PUBLIC への付与」しか撤回できず、既定由来の anon / authenticated 明示付与は残存する。
-- 結果、service_role 限定の意図に反して以下が anon から実行可能になっていた
-- （ローカル fresh-apply 実測: has_function_privilege('anon','find_bulk_review_ips...','EXECUTE')=true）:
--   - check_rate_limit          : rate-limit カウンタ（service_role 経由のみの想定）
--   - find_bulk_review_ips      : reviewer_ip(PII) を返す → anon の RPC で IP 列挙＝PII露出の恐れ
--   - get_incident_thread       : Slack incident スレッド ts キャッシュ（server 専用）
--   - record_incident_thread    : 同上
--
-- 【恒久対策（発症前予防）】PUBLIC だけでなく anon / authenticated を「明示的に」REVOKE する。
-- service_role への GRANT は各定義側で付与済みのため、最終状態は service_role のみ実行可能。
-- create_booking_atomic は anon/authenticated へ意図的に GRANT しているため対象外。
-- 本 migration は全 migration の最後（関数定義・各 GRANT より後）に置き、最終 ACL を確定させる。
-- 冪等（REVOKE は何度実行しても安全）。
-- =============================================================================

REVOKE EXECUTE ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION find_bulk_review_ips(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_incident_thread(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_incident_thread(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
