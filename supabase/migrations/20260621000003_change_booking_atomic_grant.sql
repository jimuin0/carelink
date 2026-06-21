-- 20260621000002_change_booking_atomic.sql の後続 GRANT を分離（CLI 文分割器の 42601 回避）。
-- change route はログイン済みユーザー(authenticated)が SSR anon クライアント経由で呼ぶ。冪等。

GRANT EXECUTE ON FUNCTION change_booking_atomic TO anon, authenticated;
