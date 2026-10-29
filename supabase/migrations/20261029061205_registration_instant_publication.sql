-- Additive registration publication data; existing receipts and capabilities
-- keep their original replay protocol. Nothing in this migration publishes data.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $$;
CREATE TABLE public.salon_registration_publication (
  receipt_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE RESTRICT,
  business_hours jsonb NOT NULL CHECK (public.confirmed_booking_hours(business_hours)),
  hours_hmac text NOT NULL CHECK (hours_hmac ~ '^[a-f0-9]{64}$'),
  original_pr_text text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.salon_registration_publication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_registration_publication FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.salon_registration_publication TO service_role;

-- Existing receipt HMAC remains version 1. Hours have a separate HMAC and are
-- committed under the same intent lock, so old receipts remain exactly replayable.
CREATE FUNCTION public.commit_salon_submission_with_publication(
  p_intent_id uuid,p_proof_hash text,p_canonical_version smallint,p_hmac_scheme text,
  p_payload_hmac text,p_registration jsonb,p_terms_sha256 text,p_business_hours jsonb,p_hours_hmac text
) RETURNS TABLE(outcome text,receipt_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE committed record; saved public.salon_registration_publication%ROWTYPE;
BEGIN
  IF p_hours_hmac IS NULL OR p_hours_hmac !~ '^[a-f0-9]{64}$'
    OR public.confirmed_booking_hours(p_business_hours) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'REGISTRATION_PUBLICATION_HOURS_INVALID';
  END IF;
  SELECT * INTO committed FROM public.commit_salon_submission_with_consent(
    p_intent_id,p_proof_hash,p_canonical_version,p_hmac_scheme,p_payload_hmac,p_registration,p_terms_sha256);
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_COMMIT_RESULT_UNAVAILABLE'; END IF;
  IF committed.outcome='committed' THEN
    INSERT INTO public.salon_registration_publication(receipt_id,business_hours,hours_hmac,original_pr_text)
      SELECT s.id,p_business_hours,p_hours_hmac,s.pr_text FROM public.salons s
      WHERE s.id=committed.receipt_id AND s.source='register';
    IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_PUBLICATION_RECEIPT_UNAVAILABLE'; END IF;
  ELSIF committed.outcome='replay' THEN
    SELECT p.* INTO saved FROM public.salon_registration_publication p WHERE p.receipt_id=committed.receipt_id;
    IF NOT FOUND OR saved.hours_hmac IS DISTINCT FROM p_hours_hmac
      OR saved.business_hours IS DISTINCT FROM p_business_hours THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT committed.outcome,committed.receipt_id;
END $$;
REVOKE ALL ON FUNCTION public.commit_salon_submission_with_publication(uuid,text,smallint,text,text,jsonb,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_salon_submission_with_publication(uuid,text,smallint,text,text,jsonb,text,jsonb,text)
  TO service_role;

-- Create, claim, and publish as a single transaction. A replay never publishes
-- again: a later deliberate owner unpublish must remain in force.
CREATE FUNCTION public.setup_facility_with_registration_publication(
  p_user_id uuid,p_claim_mode text,p_receipt_id uuid,p_intent_id uuid,
  p_proof_hash text,p_legacy_issued_at timestamptz,p_profile jsonb,p_license_warranted boolean
) RETURNS TABLE(outcome text,facility_id uuid,facility_slug text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result record; receipt public.salons%ROWTYPE; publication public.salon_registration_publication%ROWTYPE; updated record;
BEGIN
  BEGIN
  SELECT * INTO result FROM public.setup_facility_from_registration(p_user_id,p_claim_mode,p_receipt_id,
    p_intent_id,p_proof_hash,p_legacy_issued_at,p_profile,p_license_warranted);
  IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_SETUP_RESULT_UNAVAILABLE'; END IF;
  IF result.outcome='created' AND p_claim_mode<>'none' THEN
    SELECT * INTO receipt FROM public.salons WHERE claimed_facility_id=result.facility_id
      AND claimed_by_user_id=p_user_id FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO publication FROM public.salon_registration_publication WHERE receipt_id=receipt.id;
      IF FOUND THEN
        IF receipt.source IS DISTINCT FROM 'register'
          OR receipt.registration_license_warranted IS DISTINCT FROM true
          OR receipt.registration_terms_accepted_at IS NULL
          OR receipt.registration_terms_sha256 IS NULL
          OR NOT public.registration_verified_account(p_user_id,receipt.id)
          OR receipt.pr_text IS DISTINCT FROM publication.original_pr_text THEN
          RAISE EXCEPTION USING ERRCODE='PRA01', MESSAGE='REGISTRATION_PUBLICATION_UNVERIFIED';
        END IF;
        SELECT * INTO updated FROM public.update_facility_settings_atomic(p_user_id,result.facility_id,
          jsonb_build_object('business_hours',publication.business_hours,'status','published'));
        IF NOT FOUND OR updated.id IS DISTINCT FROM result.facility_id THEN
          RAISE EXCEPTION 'REGISTRATION_PUBLICATION_UNAVAILABLE';
        END IF;
        UPDATE public.salons SET status='auto_accepted'
          WHERE id=receipt.id AND status IN ('pending','approved');
        IF NOT FOUND THEN RAISE EXCEPTION 'REGISTRATION_PUBLICATION_STATUS_CHANGED'; END IF;
        INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
          VALUES(p_user_id,result.facility_id,'update','salons',receipt.id::text,
            jsonb_build_object('status','auto_accepted','source','verified_registration'));
        INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
          VALUES(p_user_id,result.facility_id,'publish','facility_profiles',result.facility_id::text,
            jsonb_build_object('status','published','source','verified_registration'));
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT result.outcome,result.facility_id,result.facility_slug;
  EXCEPTION WHEN SQLSTATE 'PRA01' THEN
    -- Undo the whole setup subtransaction before returning a definitive refusal.
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text;
  END;
END $$;
REVOKE ALL ON FUNCTION public.setup_facility_with_registration_publication(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setup_facility_with_registration_publication(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)
  TO service_role;
COMMIT;
