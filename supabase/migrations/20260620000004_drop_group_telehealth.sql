-- グループ予約（group_bookings / group_booking_members）と
-- オンライン相談（telehealth_sessions）機能のテーブル物理削除。
--
-- 背景: アプリ実装（admin ページ・API・客向けページ・ナビ）は PR #207 / #208 で全撤去済み。
-- 残るテーブルは UI 到達不可・無参照となったため物理削除し、「機能は消えたがスキーマが残る」
-- ドリフトを根絶する。
--
-- 安全性: これらテーブルへの被参照 FK は group_booking_members→group_bookings の同ファミリー内のみ。
-- 保持する他テーブルからの参照は無い（telehealth/group_bookings の FK は全て「出ていく」方向で、
-- facility_profiles/auth.users/staff_profiles/bookings 等の保持テーブルには影響しない）。
-- CASCADE は各テーブル付随の index / RLS policy / trigger / FK 制約も同時に除去する。
--
-- 冪等: 全て IF EXISTS。再実行・未適用環境でも安全。

-- 子（members）から先に削除（CASCADE があるため順序は不問だが明示）
DROP TABLE IF EXISTS public.group_booking_members CASCADE;
DROP TABLE IF EXISTS public.group_bookings        CASCADE;
DROP TABLE IF EXISTS public.telehealth_sessions   CASCADE;

-- group_bookings のトリガー関数はテーブルから独立（テーブル削除では自動消去されない）。
-- telehealth 側にトリガー関数は存在しない。
DROP FUNCTION IF EXISTS public.update_group_bookings_updated_at() CASCADE;
