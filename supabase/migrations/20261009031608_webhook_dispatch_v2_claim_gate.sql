-- V2 transport is opt-in per newly published payload; historical jobs are implicit V1.
-- No job/attempt/history is rewritten. Old raw CAS returns no V2 rows.
CREATE TABLE public.webhook_dispatch_claim_proofs (
  queue_id uuid PRIMARY KEY REFERENCES public.webhook_retry_queue(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
ALTER TABLE public.webhook_dispatch_claim_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_dispatch_claim_proofs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.webhook_dispatch_claim_proofs TO service_role;
CREATE FUNCTION public.guard_webhook_v2_claim() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean;
BEGIN
  IF OLD.payload->'dispatch_version' IS DISTINCT FROM '2'::jsonb THEN RETURN NEW; END IF;
  IF NEW.status='processing' AND (OLD.status IS DISTINCT FROM 'processing' OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
    UPDATE public.webhook_dispatch_claim_proofs SET consumed=true
      WHERE queue_id=OLD.id AND claimed_at=NEW.claimed_at AND NOT consumed RETURNING true INTO allowed;
    IF allowed IS DISTINCT FROM true THEN RETURN NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_webhook_v2_claim() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_guard_webhook_v2_claim BEFORE UPDATE ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION public.guard_webhook_v2_claim();
CREATE FUNCTION public.claim_webhook_retry_queue_v2(p_job_ids uuid[],p_claimed_at timestamptz)
RETURNS SETOF public.webhook_retry_queue LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE selected_id uuid; selected_job public.webhook_retry_queue%ROWTYPE;
BEGIN
  IF p_job_ids IS NULL OR cardinality(p_job_ids)>250 OR p_claimed_at IS NULL THEN RAISE EXCEPTION 'WEBHOOK_CLAIM_INVALID'; END IF;
  FOR selected_id IN SELECT DISTINCT x FROM unnest(p_job_ids) x WHERE x IS NOT NULL ORDER BY x LOOP
    SELECT q.* INTO selected_job FROM public.webhook_retry_queue q WHERE q.id=selected_id
      AND q.status='pending' AND q.scheduled_at<=clock_timestamp() AND q.delivery_started_at IS NULL FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF selected_job.payload->'dispatch_version'='2'::jsonb THEN
      INSERT INTO public.webhook_dispatch_claim_proofs(queue_id,claimed_at,consumed) VALUES(selected_id,p_claimed_at,false)
        ON CONFLICT(queue_id) DO UPDATE SET claimed_at=excluded.claimed_at,consumed=false;
    END IF;
    RETURN QUERY UPDATE public.webhook_retry_queue q SET status='processing',claimed_at=p_claimed_at,delivery_started_at=NULL
      WHERE q.id=selected_id AND q.status='pending' RETURNING q.*;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_webhook_retry_queue_v2(uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_retry_queue_v2(uuid[],timestamptz) TO service_role;

CREATE FUNCTION public.webhook_dispatch_v2_version() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- A staged new producer must not create V2 jobs until the full consumer gate
  -- exists. Hold schema-affecting locks through the producer transaction.
  LOCK TABLE public.webhook_retry_queue IN ROW EXCLUSIVE MODE;
  IF to_regclass('public.webhook_dispatch_claim_proofs') IS NULL
    OR to_regprocedure('public.claim_webhook_retry_queue_v2(uuid[],timestamptz)') IS NULL
    OR to_regprocedure('public.guard_webhook_v2_claim()') IS NULL THEN RETURN 0; END IF;
  LOCK TABLE public.webhook_dispatch_claim_proofs IN ROW SHARE MODE;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.webhook_retry_queue'::regclass
    AND t.tgname='a_guard_webhook_v2_claim' AND t.tgfoid='public.guard_webhook_v2_claim()'::regprocedure
    AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) THEN RETURN 0; END IF;
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.webhook_dispatch_v2_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_dispatch_v2_version() TO service_role;
