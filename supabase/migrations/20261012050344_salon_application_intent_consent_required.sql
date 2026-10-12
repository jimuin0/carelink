-- Application registration writes must use an owned durable intent and an
-- explicit declaration. Database-owner maintenance/import retains historical
-- NULL declarations without manufacturing agreements for existing rows.
BEGIN;
CREATE FUNCTION public.guard_salon_application_registration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
  IF current_user='service_role' THEN
    context := nullif(current_setting('carelink.salon_registration_context',true),'')::jsonb;
    IF context IS NULL OR (context->>'terms_sha256') IS NULL
      OR (context->>'terms_sha256') !~ '^[a-f0-9]{64}$'
      OR NOT EXISTS(SELECT 1 FROM public.salon_submission_intents i
        WHERE i.id=(context->>'intent_id')::uuid AND i.proof_hash=context->>'proof_hash'
          AND i.salon_id IS NULL) THEN
      RAISE EXCEPTION 'REGISTRATION_INTENT_AND_CONSENT_REQUIRED';
    END IF;
    NEW.registration_terms_sha256 := context->>'terms_sha256';
    NEW.registration_terms_accepted_at := clock_timestamp();
    NEW.registration_license_warranted := true;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_salon_application_registration() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_salon_application_registration BEFORE INSERT ON public.salons
  FOR EACH ROW EXECUTE FUNCTION public.guard_salon_application_registration();

CREATE OR REPLACE FUNCTION public.commit_salon_submission_with_consent(
  p_intent_id uuid, p_proof_hash text, p_canonical_version smallint,
  p_hmac_scheme text, p_payload_hmac text, p_registration jsonb,
  p_terms_sha256 text
) RETURNS TABLE(outcome text,receipt_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE committed_outcome text; committed_receipt uuid; previous_context text;
BEGIN
  IF p_terms_sha256 IS NULL OR p_terms_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'REGISTRATION_CONSENT_VERSION_REQUIRED';
  END IF;
  -- The existing function performs final capability/HMAC/replay/expiry checks
  -- under its intent lock. That lock remains held through this entire wrapper,
  -- including receipt and outbox writes and the declaration below.
  previous_context := current_setting('carelink.salon_registration_context',true);
  PERFORM set_config('carelink.salon_registration_context',jsonb_build_object(
    'intent_id',p_intent_id,'proof_hash',p_proof_hash,'terms_sha256',p_terms_sha256)::text,true);
  SELECT c.outcome,c.receipt_id INTO committed_outcome,committed_receipt
    FROM public.commit_salon_submission(p_intent_id,p_proof_hash,p_canonical_version,
      p_hmac_scheme,p_payload_hmac,p_registration) c;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_COMMIT_RESULT_UNAVAILABLE'; END IF;
  PERFORM set_config('carelink.salon_registration_context',coalesce(previous_context,''),true);
  IF committed_outcome='committed' THEN
    UPDATE public.salons SET registration_terms_sha256=p_terms_sha256,
      registration_terms_accepted_at=clock_timestamp(),registration_license_warranted=true
      WHERE id=committed_receipt;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_CONSENT_RECEIPT_UNAVAILABLE'; END IF;
  END IF;
  -- A replay returns the original receipt and preserves its original edition,
  -- timestamp or legacy NULLs. HTTP fresh-checkbox checks belong to the server;
  -- no license verification or Auth role is inferred from this declaration.
  RETURN QUERY SELECT committed_outcome,committed_receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_salon_submission_with_consent(uuid,text,smallint,text,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_salon_submission_with_consent(uuid,text,smallint,text,text,jsonb,text)
  TO service_role;

COMMIT;
