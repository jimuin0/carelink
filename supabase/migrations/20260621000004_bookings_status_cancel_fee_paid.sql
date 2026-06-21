-- 2026-06-21: bookings.status の CHECK 制約に 'cancel_fee_paid' を追加（冪等）。
--
-- 背景（事実・8体監査 A4#1 で確定）:
--   bookings.status の CHECK 制約（20260323000003_phase4_bookings.sql:39 の inline CHECK＝
--   制約名 bookings_status_check）は ('pending','confirmed','completed','cancelled','no_show') のみで
--   'cancel_fee_paid' を含まない。一方アプリは cancel_fee_paid を正規ステータスとして扱い
--   （src/lib/booking-status.ts・stripe/webhook の payment_type='cancel_fee' で status を
--   'cancel_fee_paid' に更新）、キャンセル料 Stripe 決済が成立すると webhook の UPDATE が CHECK 制約
--   違反で失敗→Stripe が webhook をリトライし続け、入金記録と予約状態が永久に乖離する潜在時限爆弾。
--   （現状 cancel_fee の Checkout 生成経路は未実装のため未発症だが、機能追加時に確実に発火する。）
--
-- 修正（発症前の真の予防）:
--   CHECK 制約に 'cancel_fee_paid' を追加。新集合は旧集合の上位集合のため既存行は全て通過＝無破壊。
--
-- 冪等性: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT。再適用しても安全。

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'cancel_fee_paid'));
