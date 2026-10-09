-- V1/v2 compatibility without provider I/O. All fixture rows roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.assert_dispatch(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'dispatch fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_dispatch(NOT has_function_privilege('anon','public.claim_webhook_retry_queue_v2(uuid[],timestamptz)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.webhook_dispatch_v2_version()','EXECUTE'),'claim/readiness service only');
INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,payload,status,scheduled_at,attempt_count)
 VALUES('bed10000-0000-4000-8000-000000000001','line_push','synthetic-v1','{"message":"synthetic"}','pending',now()-interval '1 minute',0),
 ('bed10000-0000-4000-8000-000000000002','booking_creation_push','synthetic-v2','{"dispatch_version":2,"title":"Synthetic","body":"Synthetic"}','pending',now()-interval '1 minute',0);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_dispatch(public.webhook_dispatch_v2_version()=1,'complete dispatch ready');
DO $$ DECLARE affected int; ids uuid[]; BEGIN
 WITH changed AS (UPDATE public.webhook_retry_queue SET status='processing',claimed_at='2030-01-01T00:00Z',attempt_count=attempt_count+1
   WHERE id IN ('bed10000-0000-4000-8000-000000000001','bed10000-0000-4000-8000-000000000002') AND status='pending' RETURNING id)
 SELECT count(*),array_agg(id) INTO affected,ids FROM changed;
 PERFORM pg_temp.assert_dispatch(affected=1 AND ids=ARRAY['bed10000-0000-4000-8000-000000000001'::uuid],'old raw worker claims V1 only');
 PERFORM pg_temp.assert_dispatch((SELECT status='pending' AND attempt_count=0 FROM public.webhook_retry_queue WHERE id='bed10000-0000-4000-8000-000000000002'),'old worker never consumes V2 attempt');
 PERFORM pg_temp.assert_dispatch((SELECT count(*)=1 FROM public.claim_webhook_retry_queue_v2(ARRAY['bed10000-0000-4000-8000-000000000001'::uuid,'bed10000-0000-4000-8000-000000000002'::uuid],'2030-01-01T00:01Z')),'new gateway claims V2 exactly once');
 PERFORM pg_temp.assert_dispatch((SELECT consumed=true AND claimed_at='2030-01-01T00:01Z' FROM public.webhook_dispatch_claim_proofs WHERE queue_id='bed10000-0000-4000-8000-000000000002'),'one-shot proof consumed in same transaction');
 UPDATE public.webhook_retry_queue SET claimed_at='2030-01-01T00:02Z',attempt_count=attempt_count+1 WHERE id='bed10000-0000-4000-8000-000000000002';
 GET DIAGNOSTICS affected=ROW_COUNT;
 PERFORM pg_temp.assert_dispatch(affected=0 AND (SELECT attempt_count=0 FROM public.webhook_retry_queue WHERE id='bed10000-0000-4000-8000-000000000002'),'proof cannot be replayed to steal/consume another claim');
 PERFORM pg_temp.assert_dispatch((SELECT count(*)=0 FROM public.claim_webhook_retry_queue_v2(ARRAY['bed10000-0000-4000-8000-000000000002'::uuid],'2030-01-01T00:03Z')),'another consumer cannot claim processing row');
END $$;
RESET ROLE;
ALTER TABLE public.webhook_retry_queue DISABLE TRIGGER a_guard_webhook_v2_claim;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_dispatch(public.webhook_dispatch_v2_version()=0,'disabled old-worker backstop stops readiness');
RESET ROLE;
ROLLBACK;
