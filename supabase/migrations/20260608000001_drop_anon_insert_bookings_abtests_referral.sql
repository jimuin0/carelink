-- 発症前予防: bookings / ab_test_events / referral_uses の anon 直 INSERT を閉鎖
--
-- 事実確認（コード・migration 全件調査済み）:
--   - bookings:      create_booking_atomic RPC が SECURITY DEFINER (postgres 権限) で
--                   全 INSERT を担当。/api/booking は RPC 経由のみ。
--                   anon が REST で直接 INSERT → 予約バリデーション迂回・偽予約リスク。
--   - ab_test_events: /api/ab-test は createServiceRoleClient() で INSERT。
--                   anon が REST で直接 INSERT → 分析データ汚染リスク。
--   - referral_uses: /api/referral は service_role + 認証必須。
--                   anon が REST で直接 INSERT → 不正紹介レコード作成リスク。
--
-- 副作用なし確認:
--   - 各 API は service_role または SECURITY DEFINER RPC を使用（RLS をバイパス）。
--   - anon INSERT RLS 削除後も API の動作は変わらない。
--   - 削除するのは INSERT ポリシーのみ（SELECT/UPDATE ポリシーは触らない）。

-- 1. bookings: anon 直 INSERT を閉鎖
--    create_booking_atomic (SECURITY DEFINER) が全 INSERT を管理するため不要。
DROP POLICY IF EXISTS "bookings_insert" ON bookings;

-- 2. ab_test_events: anon 直 INSERT を閉鎖
--    /api/ab-test が service_role で INSERT するため不要。
DROP POLICY IF EXISTS "ab_test_insert" ON ab_test_events;

-- 3. referral_uses: anon 直 INSERT を閉鎖
--    /api/referral が service_role で INSERT し認証も必須のため不要。
DROP POLICY IF EXISTS "Referral uses insert" ON referral_uses;
