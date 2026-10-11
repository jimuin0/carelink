-- Synthetic counter keys only. Every write/trigger toggle is rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' AND NOT(current_database()='postgres'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')) THEN
    RAISE EXCEPTION 'isolated quota fixture database required';
  END IF;
  IF EXISTS(SELECT 1 FROM public.rate_limit_buckets WHERE key LIKE '%quota-fixture-ec41%') THEN
    RAISE EXCEPTION 'quota fixture namespace collision';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_quota(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'quota fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_quota(public.chat_quota_retention_version()=1,'installed trigger confirmed');
SELECT pg_temp.assert_quota(NOT has_function_privilege('anon','public.chat_quota_retention_version()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.chat_quota_retention_version()','EXECUTE'),'metadata marker service-only');
SELECT pg_temp.assert_quota(has_function_privilege('service_role','public.chat_quota_retention_version()','EXECUTE'),'server can attest retention');
SELECT pg_temp.assert_quota(NOT has_function_privilege('service_role','public.retain_active_chat_quota()','EXECUTE'),'trigger has no direct caller');
INSERT INTO public.rate_limit_buckets(key,count,window_start) VALUES
 ('chat-daily:quota-fixture-ec41-recent',2,clock_timestamp()-interval '2 hours'),
 ('chat-daily:quota-fixture-ec41-expired',2,clock_timestamp()-interval '26 hours'),
 ('chat:quota-fixture-ec41-burst',2,clock_timestamp()-interval '2 hours');
-- Reproduce the old hourly cleanup exactly on our namespace.
DELETE FROM public.rate_limit_buckets WHERE key LIKE '%quota-fixture-ec41%' AND window_start<clock_timestamp()-interval '1 hour';
SELECT pg_temp.assert_quota((SELECT count(*)=1 FROM public.rate_limit_buckets WHERE key LIKE '%quota-fixture-ec41%'),'hourly cleanup keeps current daily only');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_quota(public.check_rate_limit('chat-daily:quota-fixture-ec41-recent',2,86400000),'other process cannot reset accepted quota');
SELECT pg_temp.assert_quota((SELECT count=3 FROM public.rate_limit_buckets WHERE key='chat-daily:quota-fixture-ec41-recent'),'counter remains above cap');
RESET ROLE;
UPDATE public.rate_limit_buckets SET window_start=clock_timestamp()-interval '24 hours 1 minute' WHERE key='chat-daily:quota-fixture-ec41-recent';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_quota(NOT public.check_rate_limit('chat-daily:quota-fixture-ec41-recent',2,86400000),'full24h boundary resets same shared window');
SELECT pg_temp.assert_quota((SELECT count=1 AND window_start>clock_timestamp()-interval '1 minute' FROM public.rate_limit_buckets WHERE key='chat-daily:quota-fixture-ec41-recent'),'fresh window observed');
RESET ROLE;
ALTER TABLE public.rate_limit_buckets DISABLE TRIGGER retain_active_chat_quota;
SELECT pg_temp.assert_quota(public.chat_quota_retention_version()=0,'disabled retention is not ready');
ALTER TABLE public.rate_limit_buckets ENABLE TRIGGER retain_active_chat_quota;
SELECT pg_temp.assert_quota(public.chat_quota_retention_version()=1,'enabled retention is ready');
ROLLBACK;
