-- 点検 B2-1（2026年11月13日・神原さん決定）：広告枠（featured_slots）を PAY.JP の月額サブスクで販売する。
--
-- 以前は /api/admin/featured-ads が Stripe Checkout で期間に関係なく 9,800 円を 1 回だけ請求し、
-- Stripe webhook が枠を有効化していた（販売は停止中）。PAY.JP の定期課金に作り直すため、
-- 決済側の識別子を service_role だけが読める別表に置く。
--
-- ・featured_slots には列を足さない。featured_slots は anon にも掲載中の行を見せる（featured_slots_public_read）ので、
--   PAY.JP の customer / subscription ID を同じ表に置くと公開されてしまう。
-- ・3 表とも RLS 有効・許可ポリシーなし・ブラウザのロールの権限を外す＝読み書きは service_role（API と webhook）だけ。
-- ・既存の行・列・ポリシーは変更しない（featured_slots.stripe_session_id も残置。アプリからは使わない）。
--
-- 適用順序：アプリの配信より【前】に適用する（新しいコードはこれらの表を読む。旧コードは触らないので先に入れて安全）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
  IF to_regclass('public.featured_slots') IS NULL THEN RAISE EXCEPTION 'featured_slots is missing'; END IF;
END $guard$;

-- 施設ごとの PAY.JP customer（カードは PAY.JP 側に保存され、ここには ID しか置かない）。
CREATE TABLE IF NOT EXISTS public.facility_payjp_customers (
  facility_id uuid PRIMARY KEY REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  payjp_customer_id text NOT NULL UNIQUE CHECK (payjp_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 広告枠 1 件 = PAY.JP の定期課金 1 件。status は webhook が最後に反映した状態。
CREATE TABLE IF NOT EXISTS public.featured_slot_payjp_subscriptions (
  slot_id uuid PRIMARY KEY REFERENCES public.featured_slots(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  payjp_customer_id text NOT NULL,
  payjp_subscription_id text UNIQUE CHECK (payjp_subscription_id IS NULL OR payjp_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'trial', 'paused', 'canceled', 'deleted')),
  current_period_end timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_featured_slot_payjp_facility
  ON public.featured_slot_payjp_subscriptions (facility_id, status);

-- webhook の冪等化（同じイベントの再送・重複配信を 1 回だけ処理する）。
CREATE TABLE IF NOT EXISTS public.payjp_webhook_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[A-Za-z0-9_]+$'),
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

ALTER TABLE public.facility_payjp_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_slot_payjp_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payjp_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.facility_payjp_customers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.featured_slot_payjp_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payjp_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facility_payjp_customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.featured_slot_payjp_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payjp_webhook_events TO service_role;
