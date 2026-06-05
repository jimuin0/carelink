-- 20260602000001_booking_atomic_0a000_fix.sql の後続 GRANT を分離（CLI バージョン非依存化）。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは CLI 2.75.0 系の文分割器が
-- 42601 を起こす（2.104.0 で修正済）。関数を含まない本ファイルへ GRANT を移した。
-- create_booking_atomic は 20260602000001 で定義済みのため対象は存在する。冪等。

-- API（anon / authenticated）から呼べるよう EXECUTE を再付与（冪等）。
GRANT EXECUTE ON FUNCTION create_booking_atomic TO anon, authenticated;
