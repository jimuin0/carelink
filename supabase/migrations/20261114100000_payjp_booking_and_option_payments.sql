-- 2026年11月14日（本人決定「Stripe は使用しない。PAY.JP を利用する」）：
-- 予約の前払い（オンライン決済）と有料オプションの月額を PAY.JP で受けるための表を足す。
--
-- ・予約の前払い 1 回 = booking_payjp_charges 1 行。申込を受けた時点で status='pending' の行を作り
--   （同じ予約に pending / paid は 1 行まで＝二重課金の防止）、PAY.JP の支払いが確定したら 'paid' にする。
--   通信断で結果が分からないまま残った pending は、PAY.JP の webhook（charge.succeeded の metadata.payment_id）で照合する。
-- ・有料オプション 1 件 = facility_option_payjp_subscriptions 1 行（施設 × オプションで 1 行）。
--   facility_entitlements の有効／無効は webhook（subscription.*）がこの表を通して決める。
-- ・2 表とも RLS 有効・許可ポリシーなし・ブラウザのロールの権限を外す＝読み書きは service_role（API と webhook）だけ。
-- ・旧 Stripe の表・列（stripe_sessions・stripe_events・stripe_webhook_logs・bookings.stripe_payment_intent_id・
--   facility_entitlements.stripe_subscription_id・facility_profiles.stripe_enabled / stripe_account_id）は変更しない。
--   アプリからはもう読まない。撤去は本番の行を確かめてから別の migration で行う。
--
-- 適用順序：アプリの配信より【前】に適用する（新しいコードはこれらの表を読む。旧コードは触らないので先に入れて安全）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
  IF to_regclass('public.facility_payjp_customers') IS NULL THEN RAISE EXCEPTION 'apply 20261113120100 first'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.booking_payjp_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES public.facility_profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payjp_charge_id text UNIQUE CHECK (payjp_charge_id IS NULL OR payjp_charge_id ~ '^ch_[A-Za-z0-9]+$'),
  amount integer NOT NULL CHECK (amount BETWEEN 50 AND 9999999),
  payment_type text NOT NULL CHECK (payment_type IN ('full', 'deposit')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'partial_refund', 'disputed')),
  refund_amount integer NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_payjp_charges_open
  ON public.booking_payjp_charges (booking_id) WHERE status IN ('pending', 'paid');
CREATE INDEX IF NOT EXISTS idx_booking_payjp_charges_user ON public.booking_payjp_charges (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.facility_option_payjp_subscriptions (
  facility_id uuid NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  option_key text NOT NULL CHECK (option_key ~ '^[a-z0-9_]{1,64}$'),
  payjp_customer_id text NOT NULL,
  payjp_subscription_id text UNIQUE CHECK (payjp_subscription_id IS NULL OR payjp_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'trial', 'paused', 'canceled', 'deleted')),
  current_period_end timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, option_key)
);

ALTER TABLE public.booking_payjp_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_option_payjp_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.booking_payjp_charges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.facility_option_payjp_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payjp_charges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_option_payjp_subscriptions TO service_role;
