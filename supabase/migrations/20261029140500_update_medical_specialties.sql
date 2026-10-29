-- Keep settings and specialties in a single authorized transaction.
BEGIN;
CREATE FUNCTION public.update_facility_settings_with_specialties(
  p_actor_id uuid,p_facility_id uuid,p_patch jsonb,p_specialties text[]
) RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE updated record; business_type text;
BEGIN
  IF NOT public.valid_medical_specialties(p_specialties) OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR NOT (p_patch ? 'business_type') THEN RAISE EXCEPTION 'MEDICAL_SPECIALTIES_INVALID'; END IF;
  business_type := p_patch->>'business_type';
  IF business_type IS NULL OR (cardinality(p_specialties)>0 AND business_type NOT IN (
    '病院','総合病院','診療所・クリニック（複数診療科）','その他の医療機関',
    '内科','呼吸器内科','循環器内科','消化器内科','糖尿病内科','腎臓内科','脳神経内科',
    '外科','整形外科','脳神経外科','形成外科','小児科','耳鼻咽喉科','眼科','皮膚科','泌尿器科',
    '産婦人科','婦人科','精神科','心療内科','アレルギー科','リウマチ科','リハビリテーション科',
    '歯科','小児歯科','矯正歯科','歯科口腔外科')) THEN RAISE EXCEPTION 'MEDICAL_SPECIALTIES_INVALID'; END IF;
  SELECT * INTO updated FROM public.update_facility_settings_atomic(p_actor_id,p_facility_id,p_patch);
  IF NOT FOUND OR updated.id IS DISTINCT FROM p_facility_id THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  UPDATE public.facility_profiles SET medical_specialties=p_specialties WHERE facility_profiles.id=p_facility_id;
  RETURN QUERY SELECT p_facility_id;
END $$;
REVOKE ALL ON FUNCTION public.update_facility_settings_with_specialties(uuid,uuid,jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_facility_settings_with_specialties(uuid,uuid,jsonb,text[]) TO service_role;
COMMIT;
