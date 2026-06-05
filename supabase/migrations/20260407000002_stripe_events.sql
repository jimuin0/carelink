-- Stripe Webhook 冪等性管理テーブル
-- 同一eventの二重処理を防止

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- service_role のみ書き込み・読み取り可（一般ユーザー不可）
CREATE POLICY "stripe_events_service_only" ON stripe_events
  FOR ALL USING (false) WITH CHECK (false);

-- bookings.payment_status に 'failed' を追加
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'failed', 'refunded', 'partial_refund'));

