-- PAY.JP 移行 Phase 1: 予約の PAY.JP 課金IDを記録する列を追加（加算的・既存に影響なし）
--
-- PAY.JP は同期課金(charges.create)のため、課金成立時に charge.id を予約に保存する。
-- Stripe の stripe_payment_intent_id とは別に保持し、移行期は両者が併存できるようにする。
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payjp_charge_id TEXT;
