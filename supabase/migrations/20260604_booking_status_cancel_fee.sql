-- bookings.status CHECK に 'cancel_fee_paid' を追加（round3 監査 #02）
--
-- 背景: コード層は 'cancel_fee_paid' を第6の正規ステータスとして実装済み
--   - src/app/api/stripe/webhook/route.ts:117  status='cancel_fee_paid' に UPDATE（キャンセル料決済完了時）
--   - src/app/api/booking/[id]/cancel/route.ts:62  キャンセル不可ステータス集合に含む
-- しかし DB の CHECK 制約は初期5値(pending/confirmed/completed/cancelled/no_show)のままで、
-- Stripe checkout.session.completed(payment_type=cancel_fee) の UPDATE が 23514 制約違反→webhook 500→Stripe 無限リトライ。
-- キャンセル料は課金済みなのに予約状態が遷移しない。許可集合を拡張して状態遷移を成立させる（加算的・既存値は不変＝低リスク）。
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'cancel_fee_paid'));
