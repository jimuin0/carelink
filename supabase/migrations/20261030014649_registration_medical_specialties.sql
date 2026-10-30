-- Preserve version-1 receipts: only submissions with explicitly selected
-- specialties use this transactional wrapper. Their canonical HMAC includes
-- the selected values; a replay cannot replace the originally saved values.
BEGIN;
CREATE FUNCTION public.commit_salon_submission_with_specialties(
  p_intent_id uuid,p_proof_hash text,p_canonical_version smallint,p_hmac_scheme text,
  p_payload_hmac text,p_registration jsonb,p_terms_sha256 text
) RETURNS TABLE(outcome text,receipt_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result record; specialties text[];
BEGIN
  IF jsonb_typeof(p_registration->'medical_specialties') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'MEDICAL_SPECIALTIES_INVALID'; END IF;
  SELECT array_agg(v ORDER BY ordinality) INTO specialties
    FROM jsonb_array_elements_text(p_registration->'medical_specialties') WITH ORDINALITY AS s(v,ordinality);
  IF cardinality(specialties) < 1 OR NOT public.valid_medical_specialties(specialties)
    OR p_registration->>'business_type' IS NULL OR p_registration->>'business_type' NOT IN ('病院','総合病院','診療所・クリニック（複数診療科）','その他の医療機関',
      '内科','呼吸器内科','循環器内科','消化器内科','糖尿病内科','腎臓内科','脳神経内科',
      '外科','整形外科','脳神経外科','形成外科','小児科','耳鼻咽喉科','眼科','皮膚科','泌尿器科',
      '産婦人科','婦人科','精神科','心療内科','アレルギー科','リウマチ科','リハビリテーション科',
      '歯科','小児歯科','矯正歯科','歯科口腔外科')
  THEN RAISE EXCEPTION 'MEDICAL_SPECIALTIES_INVALID'; END IF;
  SELECT * INTO result FROM public.commit_salon_submission_with_consent(p_intent_id,p_proof_hash,p_canonical_version,
    p_hmac_scheme,p_payload_hmac,p_registration,p_terms_sha256);
  IF result.outcome='committed' THEN
    UPDATE public.salons SET medical_specialties=specialties WHERE id=result.receipt_id;
  ELSIF result.outcome='replay' AND NOT EXISTS (SELECT 1 FROM public.salons
    WHERE id=result.receipt_id AND medical_specialties=specialties) THEN
    RAISE EXCEPTION 'MEDICAL_SPECIALTIES_REPLAY_MISMATCH';
  END IF;
  RETURN QUERY SELECT result.outcome::text,result.receipt_id::uuid;
END $$;
REVOKE ALL ON FUNCTION public.commit_salon_submission_with_specialties(uuid,text,smallint,text,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_salon_submission_with_specialties(uuid,text,smallint,text,text,jsonb,text) TO service_role;

CREATE FUNCTION public.copy_registration_medical_specialties() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.claimed_facility_id IS NULL AND NEW.claimed_facility_id IS NOT NULL AND cardinality(NEW.medical_specialties)>0 THEN
    UPDATE public.facility_profiles SET medical_specialties=NEW.medical_specialties WHERE id=NEW.claimed_facility_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MEDICAL_SPECIALTIES_FACILITY_NOT_FOUND'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.copy_registration_medical_specialties() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.copy_registration_medical_specialties() TO service_role;
CREATE TRIGGER copy_registration_medical_specialties AFTER UPDATE OF claimed_facility_id ON public.salons
  FOR EACH ROW EXECUTE FUNCTION public.copy_registration_medical_specialties();
COMMIT;
