-- CL-18: 外部送信後にキュー状態を書けない場合の自動再送停止状態。
DO $guard$
BEGIN
  IF to_regclass('public.webhook_retry_queue') IS NULL THEN
    RAISE EXCEPTION 'webhook_retry_queueが見つかりません。接続先を確認してください。';
  END IF;
  IF to_regclass('public.stripe_events') IS NULL THEN
    RAISE EXCEPTION 'stripe_eventsが見つかりません。接続先を確認してください。';
  END IF;
END
$guard$;

ALTER TABLE public.webhook_retry_queue
  DROP CONSTRAINT IF EXISTS webhook_retry_queue_status_check;

ALTER TABLE public.webhook_retry_queue
  ADD CONSTRAINT webhook_retry_queue_status_check
  CHECK (status IN ('pending', 'processing', 'success', 'failed', 'cancelled', 'ambiguous'));
-- Payment webhook idempotency rows also need an explicit ambiguous state when
-- rollback itself fails. Without it, a committed idempotency row can make every
-- Stripe retry return duplicate=true forever.
ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processed';
ALTER TABLE public.stripe_events
  DROP CONSTRAINT IF EXISTS stripe_events_status_check;
ALTER TABLE public.stripe_events
  ADD CONSTRAINT stripe_events_status_check
  CHECK (status IN ('processing', 'processed', 'ambiguous'));
