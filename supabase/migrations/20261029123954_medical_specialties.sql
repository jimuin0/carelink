-- Diagnoses are separate from the facility's primary category. Existing
-- receipts and facilities remain unchanged until the application opts in.
BEGIN;

CREATE FUNCTION public.valid_medical_specialties(p_values text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_values IS NOT NULL
    AND array_position(p_values, NULL) IS NULL
    AND p_values <@ ARRAY[
      '内科','呼吸器内科','循環器内科','消化器内科','糖尿病内科','腎臓内科','脳神経内科',
      '外科','整形外科','脳神経外科','形成外科','小児科','耳鼻咽喉科','眼科','皮膚科',
      '泌尿器科','産婦人科','婦人科','精神科','心療内科','アレルギー科','リウマチ科',
      'リハビリテーション科','歯科','小児歯科','矯正歯科','歯科口腔外科'
    ]::text[]
    AND cardinality(p_values) = (SELECT count(DISTINCT specialty) FROM unnest(p_values) specialty);
$$;
REVOKE ALL ON FUNCTION public.valid_medical_specialties(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_medical_specialties(text[]) TO service_role;

ALTER TABLE public.salons ADD COLUMN medical_specialties text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.facility_profiles ADD COLUMN medical_specialties text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.salons ADD CONSTRAINT salons_medical_specialties_valid
  CHECK (public.valid_medical_specialties(medical_specialties));
ALTER TABLE public.facility_profiles ADD CONSTRAINT facility_medical_specialties_valid
  CHECK (public.valid_medical_specialties(medical_specialties));
CREATE INDEX facility_profiles_medical_specialties_gin
  ON public.facility_profiles USING gin (medical_specialties);

COMMIT;
