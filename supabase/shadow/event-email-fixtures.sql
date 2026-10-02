-- Rollback-only synthetic ledger. No provider connection or real recipient.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_manual_20261001')
  THEN RAISE EXCEPTION 'disposable shadow database required'; END IF; END $$;
INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,payload,email_envelope,status,claimed_at)
VALUES('e1000000-0000-4000-8000-000000000001','email','synthetic@example.invalid',
  '{"event_email_version":1,"idempotency_key":"carelink-event-email/e1000000-0000-4000-8000-000000000001"}',
  '{"from":"CareLink <noreply@carelink-jp.com>","to":"synthetic@example.invalid","subject":"fixture","html":"<p>fixture</p>"}',
  'processing','2026-10-01T00:00:00Z');
DO $$ BEGIN
  BEGIN UPDATE public.webhook_retry_queue SET payload='{}' WHERE id='e1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'payload mutation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EVENT_EMAIL_IDENTITY_IMMUTABLE' THEN RAISE; END IF; END;
  BEGIN UPDATE public.webhook_retry_queue SET email_envelope='{}' WHERE id='e1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'envelope mutation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EVENT_EMAIL_IDENTITY_IMMUTABLE' THEN RAISE; END IF; END;
END $$;
UPDATE public.webhook_retry_queue SET delivery_started_at='2026-10-01T00:00:00Z'
WHERE id='e1000000-0000-4000-8000-000000000001' AND status='processing' AND claimed_at='2026-10-01T00:00:00Z' AND delivery_started_at IS NULL;
-- Successful provider-only reconciliation beats a delayed rejection handler.
UPDATE public.webhook_retry_queue SET status='success',provider_message_id='e2000000-0000-4000-8000-000000000001'
WHERE id='e1000000-0000-4000-8000-000000000001' AND status='processing' AND delivery_started_at='2026-10-01T00:00:00Z';
DO $$ DECLARE changed int; BEGIN
  UPDATE public.webhook_retry_queue SET status='pending',claimed_at=NULL,delivery_started_at=NULL
    WHERE id='e1000000-0000-4000-8000-000000000001' AND status='processing' AND claimed_at='2026-10-01T00:00:00Z'
      AND delivery_started_at='2026-10-01T00:00:00Z';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'stale handler reverted accepted job'; END IF;
  BEGIN UPDATE public.webhook_retry_queue SET provider_message_id='e2000000-0000-4000-8000-000000000002'
    WHERE id='e1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'provider identity mutation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EVENT_EMAIL_IDENTITY_IMMUTABLE' THEN RAISE; END IF; END;
END $$;
-- SQL NULL in a missing JSON key must not bypass the CHECK constraint.
DO $$ BEGIN
  BEGIN INSERT INTO public.webhook_retry_queue(webhook_type,target_id,payload,email_envelope)
    VALUES('email','synthetic@example.invalid','{}','{"from":"fixture"}');
    RAISE EXCEPTION 'incomplete envelope accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;
