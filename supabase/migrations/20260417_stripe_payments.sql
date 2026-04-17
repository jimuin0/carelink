-- Stripe 決済テーブル
-- デポジット（事前決済）管理

CREATE TABLE IF NOT EXISTS stripe_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INT NOT NULL CHECK (amount > 0),        -- 金額（円）
  currency TEXT NOT NULL DEFAULT 'jpy',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
  payment_type TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_type IN ('deposit', 'full', 'cancel_fee')),
  refund_amount INT DEFAULT 0,
  refunded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_sessions_booking ON stripe_sessions(booking_id);
CREATE INDEX IF NOT EXISTS idx_stripe_sessions_user ON stripe_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_sessions_stripe_id ON stripe_sessions(stripe_session_id);

ALTER TABLE stripe_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stripe_sessions_user" ON stripe_sessions
  FOR SELECT USING (user_id = auth.uid());

-- Webhook イベントログ
CREATE TABLE IF NOT EXISTS stripe_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 施設のStripe Connect アカウント
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_amount INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_type TEXT DEFAULT 'none'
    CHECK (deposit_type IN ('none', 'fixed', 'percent'));
