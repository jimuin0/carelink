-- 2026年11月14日：決済を Stripe から PAY.JP へ移した（PR #932・migration 20261114100000）ため、
-- アプリから読まなくなった旧 Stripe の表・列を撤去する。
--
-- 撤去前に本番（xzafxiupbflvgbarrihe）で確かめたこと（2026年11月14日）：
--   ・stripe_sessions / stripe_events / stripe_webhook_logs はいずれも 0 行
--   ・bookings.stripe_payment_intent_id / facility_entitlements.stripe_subscription_id / featured_slots.stripe_session_id、
--     facility_profiles.stripe_enabled（true の行）/ stripe_account_id（非 NULL の行）はいずれも 0 行
--   ・public の関数・ビュー・RLS ポリシーで 'stripe' を参照するものは無い
-- 失うデータは無い。DROP は依存があれば失敗する（CASCADE は付けない＝想定外の連鎖削除をしない）。
--
-- facility_profiles の SELECT 権は列単位のまま（20261113110100）。stripe_account_id の列 GRANT は列と一緒に消える。
-- 適用順序：この migration を含むアプリの配信【後】に適用する（旧コードはもう残っていないので前後どちらでも動くが、
-- 型・期待値と本番を同じ日に揃えるため配信直後に適用する）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
  IF to_regclass('public.booking_payjp_charges') IS NULL THEN RAISE EXCEPTION 'apply 20261114100000 first'; END IF;
END $guard$;

DROP TABLE IF EXISTS public.stripe_sessions;
DROP TABLE IF EXISTS public.stripe_events;
DROP TABLE IF EXISTS public.stripe_webhook_logs;

ALTER TABLE public.bookings DROP COLUMN IF EXISTS stripe_payment_intent_id;
ALTER TABLE public.facility_entitlements DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE public.featured_slots DROP COLUMN IF EXISTS stripe_session_id;
ALTER TABLE public.facility_profiles DROP COLUMN IF EXISTS stripe_enabled;
ALTER TABLE public.facility_profiles DROP COLUMN IF EXISTS stripe_account_id;
