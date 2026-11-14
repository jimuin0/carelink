-- Only synthetic booking fixtures may call this helper, inside their rollback
-- transaction. It uses the real authorization and publication gate; no trigger
-- is disabled and no production database is accepted.
CREATE OR REPLACE FUNCTION pg_temp.approve_synthetic_listing(p_facility_id uuid,p_owner_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE operator_id uuid := 'fb520000-0000-4000-8000-000000000001'; doc_id uuid := gen_random_uuid();
  result record; identity jsonb;
BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF p_owner_id IS NULL THEN
    p_owner_id := 'fb530000-0000-4000-8000-000000000001';
    INSERT INTO auth.users(id,email,email_confirmed_at)
      VALUES(p_owner_id,'fixture-owner@example.invalid',now()) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES(p_owner_id,p_facility_id,'owner');
  END IF;
  INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES(operator_id,'fixture-reviewer@example.invalid',now()) ON CONFLICT (id) DO NOTHING;
  UPDATE public.profiles SET is_platform_admin=true WHERE id=operator_id;
  SELECT * INTO result FROM public.prepare_listing_verification_document(p_owner_id,p_facility_id,doc_id,
    'other','application/pdf',5,repeat('a',64));
  IF result.outcome <> 'prepared' THEN RAISE EXCEPTION 'FIXTURE_PREPARATION_FAILED'; END IF;
  INSERT INTO storage.objects(bucket_id,name) VALUES('listing-verification',result.object_path);
  SELECT jsonb_build_object('name',name,'prefecture',prefecture,'city',city,'address',address)
    INTO identity FROM public.facility_profiles WHERE id=p_facility_id;
  IF NOT public.approve_listing_verification(operator_id,p_facility_id,ARRAY[doc_id],identity,true,true)
    THEN RAISE EXCEPTION 'FIXTURE_APPROVAL_FAILED'; END IF;
END $$;
