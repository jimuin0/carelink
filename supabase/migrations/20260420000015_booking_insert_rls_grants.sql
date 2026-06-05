-- 20260420000003_booking_insert_rls.sql の後続文を分離（CLI バージョン非依存化）。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは Supabase CLI 2.75.0 系の
-- 文分割器が 1 チャンク化して 42601(cannot insert multiple commands into a prepared
-- statement) を起こす（2.104.0 で修正済）。関数定義（20260420000003）の後続だった
-- DROP POLICY / GRANT を本ファイル（関数を含まない＝バグ条件外）へ移した。
-- create_booking_atomic は直前の 20260420000003 で定義済みのため GRANT 対象は存在する。

-- Drop the overbroad client INSERT policy — SECURITY DEFINER handles all inserts.
DROP POLICY IF EXISTS "bookings_insert" ON bookings;

-- Grant EXECUTE on the function to anon and authenticated so the API can call it.
GRANT EXECUTE ON FUNCTION create_booking_atomic TO anon, authenticated;
