-- 2026年6月26日: 決済ステータスの CHECK 制約に dispute/部分返金の値を追加（冪等・無破壊）。
--
-- 背景（事実・敵対監査で確定）:
--   src/app/api/stripe/webhook/route.ts が Stripe イベント受信時に以下を書き込むが、
--   対応する CHECK 制約に当該値が存在せず、書き込みが CHECK 制約違反（23514）で失敗する:
--     - charge.dispute.created  → bookings.payment_status='disputed' / stripe_sessions.status='disputed'
--     - charge.dispute.closed   → bookings.payment_status='dispute_lost' / stripe_sessions.status='dispute_lost'
--     - charge.refunded(部分)   → stripe_sessions.status='partial_refund'
--   さらに当該 webhook の dispute/refund ハンドラは error を捕捉していなかったため（本PRのコード修正で
--   error 捕捉+throw に統一）、CHECK 違反が【無音で no-op】され、チャージバック・部分返金が DB に
--   一切記録されず管理ダッシュボードに反映されない潜在バグだった。
--
--   制約の現状（事実）:
--     bookings.payment_status（20260407000002_stripe_events.sql:19）
--       = ('unpaid','paid','failed','refunded','partial_refund')  ← disputed/dispute_lost 不在
--     stripe_sessions.status（20260417000031_stripe_payments.sql:14）
--       = ('pending','paid','cancelled','refunded','expired')      ← disputed/dispute_lost/partial_refund 不在
--
-- 修正（発症前の真の予防）:
--   両 CHECK 制約に不足値を追加。新集合は旧集合の上位集合のため既存行は全て通過＝無破壊。
--
-- 冪等性: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT。再適用しても安全。

-- bookings.payment_status: disputed / dispute_lost を追加
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'refunded', 'partial_refund', 'disputed', 'dispute_lost'));

-- stripe_sessions.status: disputed / dispute_lost / partial_refund を追加
ALTER TABLE stripe_sessions DROP CONSTRAINT IF EXISTS stripe_sessions_status_check;
ALTER TABLE stripe_sessions ADD CONSTRAINT stripe_sessions_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'expired', 'partial_refund', 'disputed', 'dispute_lost'));
