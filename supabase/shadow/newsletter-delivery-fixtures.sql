-- Dedicated synthetic PG17 only; all changes roll back and no provider is called.
BEGIN;
CREATE FUNCTION pg_temp.assert_newsletter(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'newsletter fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.claim_newsletter(q uuid,stamp timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE public.webhook_retry_queue SET scheduled_at=LEAST(scheduled_at,stamp) WHERE id=q AND status='pending';
 IF to_regprocedure('public.claim_webhook_retry_queue_v2(uuid[],timestamp with time zone)') IS NOT NULL THEN
  EXECUTE 'SELECT count(*) FROM public.claim_webhook_retry_queue_v2(ARRAY[$1],$2)' USING q,stamp;
 ELSE UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q; END IF;
 PERFORM pg_temp.assert_newsletter((SELECT status='processing' AND claimed_at=stamp FROM public.webhook_retry_queue WHERE id=q),'version-compatible queue claim');
END $$;
SELECT pg_temp.assert_newsletter(current_setting('server_version_num')::int BETWEEN 170000 AND 179999,'PG17');
SELECT pg_temp.assert_newsletter(current_database() LIKE 'carelink_shadow%' OR
 (current_database()='postgres' AND current_setting('application_name')='carelink-batch2-newsletter'),'isolated target');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed110000-0000-4000-8000-000000000001','newsletter-admin@example.invalid',now()),
 ('ed110000-0000-4000-8000-000000000002','newsletter-account@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='ed110000-0000-4000-8000-000000000001';
INSERT INTO public.newsletter_subscriptions(email,subscription_type,is_active) VALUES
 ('newsletter-guest@example.invalid','user_digest',true),('newsletter-account@example.invalid','user_digest',true);
UPDATE public.newsletter_subscriptions SET user_id='ed110000-0000-4000-8000-000000000002' WHERE email='newsletter-account@example.invalid';
-- Transaction-local JWT function matches controlled synthetic claims in both
-- the fresh shadow bootstrap and the real local Auth schema.
DO $$ BEGIN IF current_database() LIKE 'carelink_shadow%' THEN EXECUTE $uid$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $claims$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $claims$ $uid$; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','ed110000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_newsletter((SELECT count(*)=1 FROM public.newsletter_subscriptions WHERE email='newsletter-account@example.invalid'),'owned SELECT retained');
DO $$ BEGIN BEGIN
 INSERT INTO public.newsletter_subscriptions(user_id,email,subscription_type) VALUES('ed110000-0000-4000-8000-000000000002','someone-else@example.invalid','all');
 RAISE EXCEPTION 'client can add arbitrary mailbox'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.newsletter_subscriptions SET email='someone-else@example.invalid',is_active=true WHERE email='newsletter-account@example.invalid';
 RAISE EXCEPTION 'client can change/activate arbitrary mailbox'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.newsletter_subscriptions(email,subscription_type,is_active,source) VALUES('newsletter-service-verified@example.invalid','all',false,'synthetic verified service');
SELECT pg_temp.assert_newsletter((SELECT count(*)=1 FROM public.newsletter_subscriptions WHERE email='newsletter-service-verified@example.invalid'),'service producer retained');
RESET ROLE;
INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,text_content,updated_at) VALUES
 ('ed120000-0000-4000-8000-000000000001','user_digest','Frozen subject','<p>Frozen HTML</p>','Frozen plaintext','2026-10-09T00:00:00Z'),
 ('ed120000-0000-4000-8000-000000000002','user_digest','Legacy','Legacy',NULL,'2026-10-09T00:00:00Z');
SELECT pg_temp.assert_newsletter(NOT has_function_privilege('authenticated','public.publish_newsletter_send_operation(uuid,uuid,timestamptz,text[],jsonb,text)','EXECUTE')
 AND NOT has_table_privilege('service_role','public.newsletter_send_recipients','UPDATE')
 AND NOT has_table_privilege('anon','public.email_unsubscribe_tokens','SELECT'),'least privilege');
DO $$ BEGIN BEGIN UPDATE public.newsletter_campaigns SET status='sending' WHERE id='ed120000-0000-4000-8000-000000000002';
 SET CONSTRAINTS guard_newsletter_send_operation IMMEDIATE;RAISE EXCEPTION 'old direct claim passed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_OPERATION_REQUIRED' THEN RAISE; END IF; END; END $$;
SET CONSTRAINTS guard_newsletter_send_operation DEFERRED;
DO $$ DECLARE audience text[]; links jsonb; receipt jsonb; replay jsonb; BEGIN
 SELECT array_agg(email ORDER BY email),jsonb_object_agg(email,'https://carelink-jp.com/unsubscribe?n='||repeat('a',64)) INTO audience,links FROM public.newsletter_current_recipients('user_digest') email;
 BEGIN PERFORM public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-08',audience,links,'CareLink <newsletter@carelink-jp.com>');RAISE EXCEPTION 'stale revision passed';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-09','{}',links,'CareLink <newsletter@carelink-jp.com>');RAISE EXCEPTION 'partial audience passed';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN
  PERFORM public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-09',audience,links||jsonb_build_object(audience[cardinality(audience)],'invalid-link'),'CareLink <newsletter@carelink-jp.com>');
  RAISE EXCEPTION 'partial queue publication accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_ENVELOPE_INVALID' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_newsletter(NOT EXISTS(SELECT 1 FROM public.newsletter_send_operations WHERE campaign_id='ed120000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE payload->>'campaign_id'='ed120000-0000-4000-8000-000000000001'),'mid-publication failure rolls back every queue row and operation');
 BEGIN PERFORM public.inspect_newsletter_send_operation('ed110000-0000-4000-8000-000000000002','ed120000-0000-4000-8000-000000000001');RAISE EXCEPTION 'ordinary actor accepted';EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'NEWSLETTER_PLATFORM_ACTOR_REQUIRED' THEN RAISE;END IF;END;
 BEGIN
  EXECUTE 'DROP FUNCTION public.webhook_dispatch_v2_version()';
  BEGIN PERFORM public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-09',audience,links,'CareLink <newsletter@carelink-jp.com>');
   RAISE EXCEPTION 'missing readiness allowed publication';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'NEWSLETTER_DISPATCH_UNAVAILABLE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_newsletter(NOT EXISTS(SELECT 1 FROM public.newsletter_send_operations WHERE campaign_id='ed120000-0000-4000-8000-000000000001'),'partial DDL publishes no operation');
  RAISE EXCEPTION 'restore synthetic readiness';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'restore synthetic readiness' THEN RAISE; END IF; END;
 -- Readiness is required for new publication, while an existing receipt is
 -- still safe to inspect/replay without rebuilding a queue. This local function
 -- replacement is rolled back by the synthetic exception, never committed.
 BEGIN
  EXECUTE $ready$ CREATE OR REPLACE FUNCTION public.webhook_dispatch_v2_version() RETURNS integer LANGUAGE sql AS $body$ SELECT 0 $body$ $ready$;
  BEGIN PERFORM public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-09',audience,links,'CareLink <newsletter@carelink-jp.com>');
   RAISE EXCEPTION 'readiness 0 allowed publication';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'NEWSLETTER_DISPATCH_UNAVAILABLE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_newsletter(NOT EXISTS(SELECT 1 FROM public.newsletter_send_operations WHERE campaign_id='ed120000-0000-4000-8000-000000000001'),'not-ready publishes no operation');
  RAISE EXCEPTION 'restore synthetic readiness';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'restore synthetic readiness' THEN RAISE; END IF; END;
 receipt:=public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001','2026-10-09',audience,links,'CareLink <newsletter@carelink-jp.com>');
 replay:=public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL);
 PERFORM pg_temp.assert_newsletter(receipt=replay,'lost response same operation/recipients');
 BEGIN
  EXECUTE $ready$ CREATE OR REPLACE FUNCTION public.webhook_dispatch_v2_version() RETURNS integer LANGUAGE sql AS $body$ SELECT 0 $body$ $ready$;
  PERFORM pg_temp.assert_newsletter(public.inspect_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001')=receipt,'not-ready inspection is side-effect free');
  PERFORM pg_temp.assert_newsletter(public.publish_newsletter_send_operation('ed110000-0000-4000-8000-000000000001','ed120000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL)=receipt,'not-ready replay returns old receipt');
  RAISE EXCEPTION 'restore synthetic readiness';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'restore synthetic readiness' THEN RAISE; END IF; END;

 PERFORM pg_temp.assert_newsletter((SELECT count(*)=cardinality(audience) FROM public.newsletter_send_recipients),'complete recipient publication');
END $$;
SELECT pg_temp.assert_newsletter((SELECT bool_and(email_envelope->>'text' LIKE 'Frozen plaintext%配信停止: %') FROM public.webhook_retry_queue WHERE payload->>'campaign_id'='ed120000-0000-4000-8000-000000000001'),'immutable optional plaintext with unsubscribe footer');
DO $$ DECLARE q uuid; stamp timestamptz; started record; BEGIN
 SELECT queue_id INTO q FROM public.newsletter_send_recipients WHERE email='newsletter-guest@example.invalid';
 stamp:=clock_timestamp();PERFORM pg_temp.claim_newsletter(q,stamp);
 BEGIN UPDATE public.webhook_retry_queue SET delivery_started_at=clock_timestamp() WHERE id=q;RAISE EXCEPTION 'old generic worker may send';EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'NEWSLETTER_START_PROOF_REQUIRED' THEN RAISE;END IF;END;
 SELECT * INTO started FROM public.start_newsletter_delivery(q,stamp);
 PERFORM pg_temp.assert_newsletter(started.outcome='ready','new fenced start');
 BEGIN UPDATE public.webhook_retry_queue SET status='pending',attempt_count=1,claimed_at=NULL,delivery_started_at=NULL,scheduled_at=now()+interval '5 minute' WHERE id=q;RAISE EXCEPTION 'unknown reset passed';EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'NEWSLETTER_UNKNOWN_RETRY_FORBIDDEN' THEN RAISE;END IF;END;
 PERFORM pg_temp.assert_newsletter(public.authorize_newsletter_rejected_retry(q,stamp,started.started_at),'definite rejection may authorize same owned retry');
 UPDATE public.webhook_retry_queue SET status='pending',attempt_count=1,claimed_at=NULL,delivery_started_at=NULL,scheduled_at=now()+interval '5 minute' WHERE id=q;
 PERFORM pg_temp.assert_newsletter(NOT public.authorize_newsletter_rejected_retry(q,stamp,started.started_at),'authorization single use');
 stamp:=clock_timestamp();PERFORM pg_temp.claim_newsletter(q,stamp);
 SELECT * INTO started FROM public.start_newsletter_delivery(q,stamp);
 BEGIN UPDATE public.webhook_retry_queue SET status='success',delivered_at=now() WHERE id=q;RAISE EXCEPTION 'missing provider UUID accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'NEWSLETTER_ACCEPTANCE_UNVERIFIED' THEN RAISE;END IF;END;
 UPDATE public.webhook_retry_queue SET status='success',provider_message_id='ed130000-0000-4000-8000-000000000001',delivered_at=now() WHERE id=q;
 PERFORM pg_temp.assert_newsletter((SELECT state='accepted' FROM public.newsletter_send_recipients WHERE queue_id=q),'provider accepted ledger');
END $$;
SELECT public.unsubscribe_newsletter_atomic('newsletter-account@example.invalid',NULL);
SELECT public.unsubscribe_newsletter_atomic('newsletter-new-guest@example.invalid',NULL);
SELECT pg_temp.assert_newsletter(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='newsletter-new-guest@example.invalid' AND NOT is_active),'guest durable suppression');
DO $$ DECLARE q uuid; stamp timestamptz; result record; BEGIN
 SELECT queue_id INTO q FROM public.newsletter_send_recipients WHERE email='newsletter-account@example.invalid';
 stamp:=clock_timestamp();PERFORM pg_temp.claim_newsletter(q,stamp);
 SELECT * INTO result FROM public.start_newsletter_delivery(q,stamp);
 PERFORM pg_temp.assert_newsletter(result.outcome='superseded' AND result.started_at IS NULL,'unsubscribe before start prevents provider');
 PERFORM pg_temp.assert_newsletter((SELECT state='suppressed' FROM public.newsletter_send_recipients WHERE queue_id=q),'suppression distinct from failure/accepted');
END $$;
INSERT INTO public.email_unsubscribe_tokens(token,user_id) VALUES(repeat('a',64),'ed110000-0000-4000-8000-000000000002');
SELECT public.unsubscribe_newsletter_atomic(NULL,repeat('a',64));
SELECT pg_temp.assert_newsletter((SELECT used_at IS NOT NULL FROM public.email_unsubscribe_tokens WHERE token=repeat('a',64)),'token consumed with suppression');
INSERT INTO public.email_unsubscribe_tokens(token,user_id) VALUES(repeat('b',64),'ed110000-0000-4000-8000-000000000002');
CREATE FUNCTION pg_temp.reject_token_mark() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic token failure';END $$;
CREATE TRIGGER synthetic_reject_token_mark BEFORE UPDATE ON public.email_unsubscribe_tokens FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_token_mark();
UPDATE public.profiles SET email_unsubscribed=false WHERE id='ed110000-0000-4000-8000-000000000002';
UPDATE public.newsletter_subscriptions SET is_active=true WHERE email='newsletter-account@example.invalid';
SELECT public.unsubscribe_newsletter_atomic(NULL,repeat('a',64));
SELECT pg_temp.assert_newsletter((SELECT is_active FROM public.newsletter_subscriptions WHERE email='newsletter-account@example.invalid'),'consumed token cannot alter later resubscription');
DO $$ BEGIN BEGIN PERFORM public.unsubscribe_newsletter_atomic(NULL,repeat('b',64));RAISE EXCEPTION 'token mark failure accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic token failure' THEN RAISE;END IF;END;END $$;
SELECT pg_temp.assert_newsletter((SELECT NOT email_unsubscribed FROM public.profiles WHERE id='ed110000-0000-4000-8000-000000000002') AND (SELECT is_active FROM public.newsletter_subscriptions WHERE email='newsletter-account@example.invalid'),'token failure rolls back profile and subscription');
DROP TRIGGER synthetic_reject_token_mark ON public.email_unsubscribe_tokens;
SET CONSTRAINTS guard_newsletter_send_operation IMMEDIATE;
DO $$ BEGIN BEGIN UPDATE public.newsletter_campaigns SET status='draft' WHERE id='ed120000-0000-4000-8000-000000000001';SET CONSTRAINTS guard_newsletter_send_operation IMMEDIATE;RAISE EXCEPTION 'published reset passed';EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_PUBLISHED_OPERATION_IMMUTABLE' THEN RAISE;END IF;END;END $$;
DO $$ BEGIN BEGIN UPDATE public.newsletter_campaigns SET stats=stats||'{"accepted":999}'::jsonb WHERE id='ed120000-0000-4000-8000-000000000001';SET CONSTRAINTS guard_newsletter_send_operation IMMEDIATE;RAISE EXCEPTION 'false completion stats passed';EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_LEDGER_STATE_MISMATCH' THEN RAISE;END IF;END;END $$;
SET CONSTRAINTS guard_newsletter_send_operation IMMEDIATE;
SELECT 'newsletter publication/replay/provider/suppression/rejection/permissions/rollback checks passed';
ROLLBACK;
