-- New declarations accompany the receipt without changing the historical
-- business canonical/HMAC. NULL means no declaration was recorded; never
-- manufacture one for an earlier applicant or receipt replay.
ALTER TABLE public.salons
  ADD COLUMN registration_terms_sha256 text,
  ADD COLUMN registration_terms_accepted_at timestamptz,
  ADD COLUMN registration_license_warranted boolean;
ALTER TABLE public.salons ADD CONSTRAINT salons_registration_consent_complete CHECK (
  (registration_terms_sha256 IS NULL AND registration_terms_accepted_at IS NULL
    AND registration_license_warranted IS NULL)
  OR (registration_terms_sha256 IS NOT NULL AND registration_terms_sha256 ~ '^[a-f0-9]{64}$' AND registration_terms_accepted_at IS NOT NULL
    AND registration_license_warranted IS TRUE)
);

CREATE FUNCTION public.commit_salon_submission_with_consent(
  p_intent_id uuid, p_proof_hash text, p_canonical_version smallint,
  p_hmac_scheme text, p_payload_hmac text, p_registration jsonb,
  p_terms_sha256 text
) RETURNS TABLE(outcome text,receipt_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE committed_outcome text; committed_receipt uuid;
BEGIN
  IF p_terms_sha256 IS NULL OR p_terms_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'REGISTRATION_CONSENT_VERSION_REQUIRED';
  END IF;
  -- The existing function performs final capability/HMAC/replay/expiry checks
  -- under its intent lock. That lock remains held through this entire wrapper,
  -- including receipt and outbox writes and the declaration below.
  SELECT c.outcome,c.receipt_id INTO committed_outcome,committed_receipt
    FROM public.commit_salon_submission(p_intent_id,p_proof_hash,p_canonical_version,
      p_hmac_scheme,p_payload_hmac,p_registration) c;
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_COMMIT_RESULT_UNAVAILABLE'; END IF;
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
