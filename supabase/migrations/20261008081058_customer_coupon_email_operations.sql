-- R15. Reserve the coupon and stable delivery identity together; never infer
-- "not sent" from an old NULL marker or mint another provider identity on retry.
-- The a46 legacy consumer explicitly falls back to email/code on 42703 and
-- then skips EVERY existing coupon. Renaming preserves actual acceptance
-- timestamps while preventing an old deployment from resending a new pending
-- operation through its direct, non-idempotent Resend call.
ALTER TABLE public.user_coupon_codes RENAME COLUMN notified_at TO provider_accepted_at;

CREATE TABLE IF NOT EXISTS public.customer_coupon_email_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL UNIQUE REFERENCES public.user_coupon_codes(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_coupon_email_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_coupon_email_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.customer_coupon_email_operations TO service_role;

-- PostgREST commits before returning an INSERT success. Only the new RPC can
-- create the coupon and its operation together; an old direct at_risk INSERT
-- fails at commit and its checked error path skips the provider call. Existing
-- legacy coupons are untouched. Birthday/manual coupons retain their semantics.
CREATE OR REPLACE FUNCTION public.require_at_risk_coupon_email_operation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.reason='at_risk'
    AND EXISTS(SELECT 1 FROM public.user_coupon_codes c WHERE c.id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM public.customer_coupon_email_operations o
      WHERE o.coupon_id=NEW.id AND o.facility_id=NEW.facility_id) THEN
    RAISE EXCEPTION 'COUPON_EMAIL_OPERATION_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_at_risk_coupon_email_operation() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER require_at_risk_coupon_email_operation AFTER INSERT ON public.user_coupon_codes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_at_risk_coupon_email_operation();

CREATE OR REPLACE FUNCTION public.reserve_customer_coupon_email_atomic(
  p_facility_id uuid, p_email text, p_valid_until date
) RETURNS TABLE(state text,coupon_id uuid,operation_id uuid,code text,valid_until date)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_coupon public.user_coupon_codes%ROWTYPE;
  v_operation uuid;
  v_now timestamptz := now();
BEGIN
  IF p_email IS NULL OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_valid_until IS NULL OR p_valid_until < (v_now AT TIME ZONE 'Asia/Tokyo')::date
    OR p_valid_until > (v_now AT TIME ZONE 'Asia/Tokyo')::date + 31 THEN
    RAISE EXCEPTION 'COUPON_EMAIL_INVALID_INPUT';
  END IF;
  PERFORM id FROM public.facility_profiles WHERE id=p_facility_id AND status='published' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_EMAIL_FACILITY_UNAVAILABLE'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'carelink-coupon-email:'||p_facility_id::text||':'||p_email,0));
  SELECT c.* INTO v_coupon FROM public.user_coupon_codes c
    WHERE c.facility_id=p_facility_id AND c.email=p_email AND c.reason='at_risk'
      AND c.created_at >= v_now - interval '30 days'
    ORDER BY c.created_at DESC,c.id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_coupon.provider_accepted_at IS NOT NULL THEN
      RETURN QUERY SELECT 'already_notified'::text,v_coupon.id,NULL::uuid,v_coupon.code,v_coupon.valid_until;
      RETURN;
    END IF;
    SELECT o.id INTO v_operation FROM public.customer_coupon_email_operations o WHERE o.coupon_id=v_coupon.id;
    RETURN QUERY SELECT CASE WHEN v_operation IS NULL THEN 'legacy_uncertain' ELSE 'reserved' END,
      v_coupon.id,v_operation,v_coupon.code,v_coupon.valid_until;
    RETURN;
  END IF;
  INSERT INTO public.user_coupon_codes(facility_id,email,code,discount_type,discount_value,reason,valid_until)
    VALUES(p_facility_id,p_email,'BACK'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
      'fixed',500,'at_risk',p_valid_until) RETURNING * INTO v_coupon;
  INSERT INTO public.customer_coupon_email_operations(coupon_id,facility_id)
    VALUES(v_coupon.id,p_facility_id) RETURNING id INTO v_operation;
  RETURN QUERY SELECT 'reserved'::text,v_coupon.id,v_operation,v_coupon.code,v_coupon.valid_until;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_customer_coupon_email_atomic(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_customer_coupon_email_atomic(uuid,text,date) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_customer_coupon_email_atomic(p_operation_id uuid,p_envelope jsonb)
RETURNS TABLE(id uuid,status text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_operation public.customer_coupon_email_operations%ROWTYPE;
  v_coupon public.user_coupon_codes%ROWTYPE;
  v_job public.webhook_retry_queue%ROWTYPE;
BEGIN
  SELECT o.* INTO v_operation FROM public.customer_coupon_email_operations o WHERE o.id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_EMAIL_OPERATION_NOT_FOUND'; END IF;
  -- Parent before receipt/coupon: a facility CASCADE must not wait on a child
  -- while this operation waits for its parent FK lock.
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=v_operation.facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_EMAIL_FACILITY_UNAVAILABLE'; END IF;
  -- The receipt is immutable and deliberately has no UPDATE grant. A row
  -- FOR UPDATE would require that permission; serialize its publication by ID.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-coupon-operation:'||p_operation_id::text,0));
  SELECT o.* INTO v_operation FROM public.customer_coupon_email_operations o WHERE o.id=p_operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_EMAIL_OPERATION_NOT_FOUND'; END IF;
  SELECT c.* INTO v_coupon FROM public.user_coupon_codes c WHERE c.id=v_operation.coupon_id FOR SHARE;
  IF NOT FOUND OR v_coupon.facility_id<>v_operation.facility_id THEN RAISE EXCEPTION 'COUPON_EMAIL_SCOPE_MISMATCH'; END IF;
  -- Existing immutable envelope wins. Caller data may change between weekly runs.
  SELECT q.* INTO v_job FROM public.webhook_retry_queue q WHERE q.id=p_operation_id;
  IF FOUND THEN
    IF v_job.webhook_type<>'email' OR v_job.facility_id IS DISTINCT FROM v_operation.facility_id
      OR v_job.payload->>'customer_coupon_id' IS DISTINCT FROM v_coupon.id::text
      OR v_job.target_id IS DISTINCT FROM v_coupon.email THEN RAISE EXCEPTION 'COUPON_EMAIL_QUEUE_SCOPE_MISMATCH'; END IF;
    RETURN QUERY SELECT v_job.id,CASE WHEN v_job.status='processing' AND v_job.delivery_started_at IS NOT NULL
      THEN 'uncertain' ELSE v_job.status END;
    RETURN;
  END IF;
  IF jsonb_typeof(p_envelope) IS DISTINCT FROM 'object'
    OR NOT (p_envelope ?& ARRAY['from','to','subject','html'])
    OR p_envelope - ARRAY['from','to','subject','html'] <> '{}'::jsonb
    OR jsonb_typeof(p_envelope->'from') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_envelope->'to') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_envelope->'subject') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_envelope->'html') IS DISTINCT FROM 'string'
    OR p_envelope->>'to' IS DISTINCT FROM v_coupon.email
    OR length(p_envelope->>'from') NOT BETWEEN 1 AND 320
    OR length(p_envelope->>'subject') NOT BETWEEN 1 AND 200
    OR length(p_envelope->>'html') NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'COUPON_EMAIL_ENVELOPE_INVALID';
  END IF;
  INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,email_envelope,status,scheduled_at)
    VALUES(p_operation_id,'email',v_coupon.email,v_operation.facility_id,
      jsonb_build_object('event_email_version',1,'idempotency_key','carelink-event-email/'||p_operation_id::text,
        'customer_coupon_id',v_coupon.id::text),p_envelope,'pending',now()) RETURNING * INTO v_job;
  RETURN QUERY SELECT v_job.id,v_job.status;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_customer_coupon_email_atomic(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_customer_coupon_email_atomic(uuid,jsonb) TO service_role;

-- Acceptance and coupon marker commit or roll back together, including manual
-- provider reconciliation. An uncertain started job remains fenced, never pending.
CREATE OR REPLACE FUNCTION public.record_customer_coupon_email_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_operation public.customer_coupon_email_operations%ROWTYPE;
BEGIN
  IF NEW.webhook_type='email' AND NEW.payload ? 'customer_coupon_id' AND NEW.status='success' THEN
    SELECT o.* INTO v_operation FROM public.customer_coupon_email_operations o WHERE o.id=NEW.id;
    IF NOT FOUND OR NEW.provider_message_id IS NULL OR NEW.delivered_at IS NULL
      OR v_operation.coupon_id::text IS DISTINCT FROM NEW.payload->>'customer_coupon_id'
      OR v_operation.facility_id IS DISTINCT FROM NEW.facility_id THEN
      RAISE EXCEPTION 'COUPON_EMAIL_ACCEPTANCE_NOT_CONFIRMED';
    END IF;
    UPDATE public.user_coupon_codes c SET provider_accepted_at=COALESCE(c.provider_accepted_at,NEW.delivered_at)
      WHERE c.id=v_operation.coupon_id AND c.facility_id=v_operation.facility_id AND c.email=NEW.target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_EMAIL_MARKER_NOT_CONFIRMED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_customer_coupon_email_acceptance() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS record_customer_coupon_email_acceptance ON public.webhook_retry_queue;
CREATE TRIGGER record_customer_coupon_email_acceptance AFTER INSERT OR UPDATE ON public.webhook_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.record_customer_coupon_email_acceptance();
