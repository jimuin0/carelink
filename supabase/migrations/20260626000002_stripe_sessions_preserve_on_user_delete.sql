-- 2026年6月26日: 退会時に決済履歴（stripe_sessions）を保全する（CASCADE → SET NULL・冪等）。
--
-- 背景（事実・敵対監査で確定）:
--   stripe_sessions.user_id（20260417000031_stripe_payments.sql:8）は
--     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
--   であり、src/app/api/account/delete/route.ts が auth.admin.deleteUser(user.id) で
--   auth.users を物理削除すると、当該ユーザーの stripe_sessions 全行（デポジット・全額決済・
--   返金・キャンセル料の決済記録）が CASCADE で物理消滅する。領収書再発行・会計・税務・係争対応の
--   証憑が失われる。同 route.ts は bookings.user_id を NULL 化して予約行を保全する設計なのに、
--   stripe_sessions だけがハード CASCADE という非対称だった。
--
-- 修正（発症前の真の予防・神原さん承認済み = 「保全（user_id を NULL 化）」）:
--   1. user_id の NOT NULL を解除（SET NULL するには nullable 必須）
--   2. FK を ON DELETE SET NULL に張り替え
--   退会時は user_id だけが NULL になり、決済記録（金額・ステータス・領収書根拠）は残る。
--   facility_id は施設削除時の CASCADE を維持（施設ごと消える場合は決済記録も不要なため変更しない）。
--
-- 冪等性: DROP NOT NULL は再適用安全。FK は DROP CONSTRAINT IF EXISTS → ADD で張り替え。

-- 1. NOT NULL 解除（SET NULL の前提）
ALTER TABLE stripe_sessions ALTER COLUMN user_id DROP NOT NULL;

-- 2. FK を ON DELETE SET NULL へ張り替え
ALTER TABLE stripe_sessions DROP CONSTRAINT IF EXISTS stripe_sessions_user_id_fkey;
ALTER TABLE stripe_sessions ADD CONSTRAINT stripe_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
