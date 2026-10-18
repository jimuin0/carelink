-- The preflight duplicate read is only explanatory. The database arbitrates
-- simultaneous applications, including the general-application NULL job ID.
ALTER TABLE public.job_applications ADD CONSTRAINT job_application_identity_unique
 UNIQUE NULLS NOT DISTINCT (facility_id,job_posting_id,applicant_email);

CREATE FUNCTION public.update_job_application_atomic(
 p_actor_id uuid,p_facility_id uuid,p_application_id uuid,p_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.job_applications%ROWTYPE; previous_status text; fee numeric;
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'APPLICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_facility_id IS NULL OR p_application_id IS NULL OR p_patch IS NULL
  OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb
  OR p_patch-ARRAY['status','referral_fee_yen','notes']<>'{}'::jsonb
 THEN RAISE EXCEPTION 'INVALID_APPLICATION_PATCH' USING ERRCODE='22023'; END IF;
 IF p_patch ? 'status' THEN
  IF jsonb_typeof(p_patch->'status') IS DISTINCT FROM 'string'
   OR p_patch->>'status' NOT IN ('pending','reviewing','interview_scheduled','interview_done','offer_made','hired','rejected','withdrawn')
  THEN RAISE EXCEPTION 'INVALID_APPLICATION_PATCH' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_patch ? 'notes' THEN
  IF jsonb_typeof(p_patch->'notes') NOT IN ('null','string') OR char_length(p_patch->>'notes')>2000
  THEN RAISE EXCEPTION 'INVALID_APPLICATION_PATCH' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_patch ? 'referral_fee_yen' THEN
  IF jsonb_typeof(p_patch->'referral_fee_yen')='number' THEN
   fee=(p_patch->>'referral_fee_yen')::numeric;
   IF fee<0 OR fee>9999999 OR fee<>trunc(fee) THEN RAISE EXCEPTION 'INVALID_APPLICATION_PATCH' USING ERRCODE='22023'; END IF;
  ELSIF jsonb_typeof(p_patch->'referral_fee_yen') IS DISTINCT FROM 'null' THEN
   RAISE EXCEPTION 'INVALID_APPLICATION_PATCH' USING ERRCODE='22023';
  END IF;
 END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 -- Parent before membership/application: a facility DELETE cascades through
 -- those children. KEY SHARE permits ordinary suspension/status updates.
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.job_applications WHERE id=p_application_id AND facility_id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 previous_status=a.status;
 IF p_patch ? 'status' THEN
  IF p_patch->>'status'='hired' AND a.status<>'hired' THEN a.hired_at=clock_timestamp(); END IF;
  a.status=p_patch->>'status';
 END IF;
 IF p_patch ? 'referral_fee_yen' THEN a.referral_fee_yen=fee::integer; END IF;
 IF p_patch ? 'notes' THEN a.notes=p_patch->>'notes'; END IF;
 UPDATE public.job_applications SET status=a.status,referral_fee_yen=a.referral_fee_yen,notes=a.notes,
  hired_at=a.hired_at,updated_at=clock_timestamp() WHERE id=p_application_id AND facility_id=p_facility_id RETURNING * INTO a;
 RETURN jsonb_build_object('application',to_jsonb(a)||jsonb_build_object('job_postings',
  (SELECT jsonb_build_object('title',j.title) FROM public.job_postings j WHERE j.id=a.job_posting_id)),
  'previous_status',previous_status);
END $$;
REVOKE ALL ON FUNCTION public.update_job_application_atomic(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_job_application_atomic(uuid,uuid,uuid,jsonb) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.job_applications FROM PUBLIC,anon,authenticated;
