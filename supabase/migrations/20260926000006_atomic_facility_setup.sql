-- Additive prerequisite for the new setup consumer. Do not enable that consumer
-- until fresh/upgrade/role/concurrency/rollback contracts have passed.
BEGIN;
ALTER TABLE public.salons ADD COLUMN claimed_facility_id uuid UNIQUE
  REFERENCES public.facility_profiles(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.salons.claimed_facility_id IS
  'Consumed receipt tombstone independent of auth user lifetime. No inferred legacy backfill; unclaim requires coordinated recovery.';

ALTER TABLE public.webhook_retry_queue ADD CONSTRAINT facility_welcome_reference CHECK (
  webhook_type IS DISTINCT FROM 'facility_welcome' OR (
    target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND payload IS NOT NULL AND jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['user_id','template_version']
    AND payload - ARRAY['user_id','template_version'] = '{}'::jsonb
    AND jsonb_typeof(payload->'user_id') = 'string'
    AND (payload->>'user_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND payload->'template_version' = '1'::jsonb
  )
);
CREATE UNIQUE INDEX facility_welcome_once ON public.webhook_retry_queue(webhook_type,target_id)
  WHERE webhook_type = 'facility_welcome';

CREATE FUNCTION public.setup_facility_from_registration(
  p_user_id uuid, p_claim_mode text, p_receipt_id uuid, p_intent_id uuid,
  p_proof_hash text, p_legacy_issued_at timestamptz, p_profile jsonb,
  p_license_warranted boolean
) RETURNS TABLE(outcome text, facility_id uuid, facility_slug text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  receipt public.salons%ROWTYPE;
  intent public.salon_submission_intents%ROWTYPE;
  existing_id uuid;
  selected_id uuid;
  new_id uuid;
  new_slug text;
  new_name text;
  new_business_type text;
  photo record;
  photo_slot smallint;
  matched_count integer;
BEGIN
  IF p_user_id IS NULL OR p_license_warranted IS DISTINCT FROM true
    OR p_claim_mode IS NULL OR p_claim_mode NOT IN ('none','legacy','intent')
    OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR p_profile - ARRAY['facility_name','business_type','phone','prefecture','city','address'] <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_profile) v WHERE jsonb_typeof(v.value) <> 'string') THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN;
  END IF;
  -- Fixed lock order: user -> intent -> receipt. No auth.users read privilege
  -- is required; FK insertion still rejects a nonexistent/deleted auth user.
  -- The existing one-owner unique index remains authoritative for other writers.
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-setup:' || p_user_id::text, 0));
  IF p_claim_mode = 'intent' THEN
    IF p_receipt_id IS NOT NULL OR p_legacy_issued_at IS NOT NULL THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    SELECT * INTO intent FROM public.salon_submission_intents WHERE id=p_intent_id FOR UPDATE;
    IF NOT FOUND OR intent.proof_hash IS DISTINCT FROM p_proof_hash
      OR intent.canonical_version <> 1 OR intent.hmac_scheme <> 'proof-hkdf-sha256-v1'
      OR intent.created_at > clock_timestamp()
      OR intent.created_at + interval '72 hours' <= clock_timestamp()
      OR intent.salon_id IS NULL THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    selected_id := intent.salon_id;
  ELSIF p_claim_mode = 'legacy' THEN
    -- Timestamp comes only from a successfully verified signed HttpOnly cookie,
    -- never client JSON. Recheck after waiting for the user lock.
    IF p_receipt_id IS NULL OR p_intent_id IS NOT NULL OR p_proof_hash IS NOT NULL
      OR p_legacy_issued_at IS NULL OR p_legacy_issued_at > clock_timestamp()
      OR p_legacy_issued_at + interval '72 hours' <= clock_timestamp() THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    selected_id := p_receipt_id;
  ELSE
    IF p_receipt_id IS NOT NULL OR p_intent_id IS NOT NULL OR p_proof_hash IS NOT NULL
      OR p_legacy_issued_at IS NOT NULL THEN
      RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
  END IF;

  IF selected_id IS NOT NULL THEN
    SELECT * INTO receipt FROM public.salons WHERE id=selected_id FOR UPDATE;
    IF NOT FOUND OR receipt.status = 'rejected' THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    -- Recheck lifetime after the receipt lock too: another user can hold it.
    IF (p_claim_mode='legacy' AND p_legacy_issued_at + interval '72 hours' <= clock_timestamp())
      OR (p_claim_mode='intent' AND intent.created_at + interval '72 hours' <= clock_timestamp()) THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    IF receipt.claimed_facility_id IS NOT NULL THEN
      IF receipt.claimed_by_user_id = p_user_id AND EXISTS (
        SELECT 1 FROM public.facility_members m WHERE m.facility_id=receipt.claimed_facility_id
          AND m.user_id=p_user_id AND m.role='owner'
      ) THEN
        RETURN QUERY SELECT 'replay'::text,p.id,p.slug FROM public.facility_profiles p
          WHERE p.id=receipt.claimed_facility_id;
      ELSE
        RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text;
      END IF;
      RETURN;
    END IF;
    -- An old partial claim or deleted-user tombstone is not safe to infer away.
    IF receipt.claimed_by_user_id IS NOT NULL OR receipt.claimed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
  END IF;
  SELECT m.facility_id INTO existing_id FROM public.facility_members m
    WHERE m.user_id=p_user_id ORDER BY m.created_at,m.facility_id LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'already_member'::text,p.id,p.slug FROM public.facility_profiles p WHERE p.id=existing_id;
    RETURN;
  END IF;
  -- Only the explicitly selected receipt may supply missing fields. Email is
  -- not a capability and is deliberately absent from every selector/merge.
  new_name := coalesce(nullif(p_profile->>'facility_name',''),receipt.facility_name);
  new_business_type := coalesce(nullif(p_profile->>'business_type',''),receipt.business_type);
  IF new_name IS NULL OR length(btrim(new_name))=0 OR length(new_name)>200
    OR new_business_type IS NULL OR new_business_type NOT IN
      ('ヘアサロン','ネイル・まつげサロン','リラクサロン','エステサロン','美容クリニック','鍼灸院・整骨院','ピラティス','その他') THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN;
  END IF;
  new_id := gen_random_uuid();
  new_slug := 'facility-' || new_id::text;
  INSERT INTO public.facility_profiles (
    id,name,slug,business_type,phone,prefecture,city,address,postal_code,building,
    nearest_station,business_hours_text,regular_holiday,seat_count,staff_count,
    parking,features,website_url,description,main_photo_url,status
  ) VALUES (
    new_id,new_name,new_slug,new_business_type,
    coalesce(nullif(p_profile->>'phone',''),receipt.phone),
    coalesce(nullif(p_profile->>'prefecture',''),receipt.prefecture,''),
    coalesce(nullif(p_profile->>'city',''),receipt.city,''),
    coalesce(nullif(p_profile->>'address',''),receipt.address,''),
    receipt.postal_code,receipt.building_name,receipt.nearest_station,
    receipt.business_hours,receipt.regular_holiday,receipt.seat_count,receipt.staff_count,
    coalesce(receipt.has_parking,false),coalesce(receipt.features,'{}'::text[]),
    receipt.website,receipt.pr_text,receipt.photo_url,'draft'
  );
  INSERT INTO public.facility_members(facility_id,user_id,role) VALUES(new_id,p_user_id,'owner');
  IF selected_id IS NOT NULL THEN
    UPDATE public.salons SET claimed_facility_id=new_id,claimed_by_user_id=p_user_id,
      claimed_at=clock_timestamp() WHERE id=selected_id;
    FOR photo IN SELECT url,ordinality FROM unnest(coalesce(receipt.photo_urls,'{}'::text[])) WITH ORDINALITY u(url,ordinality) LOOP
      photo_slot := NULL;
      IF p_claim_mode='intent' THEN
        -- Commit stores immutable server-derived public paths. Recover the
        -- actual optional slot, not array index (slot zero may be absent).
        SELECT count(*), min(p.slot) INTO matched_count,photo_slot
          FROM public.salon_submission_photos p WHERE p.intent_id=p_intent_id
          AND right(photo.url,length('/storage/v1/object/public/carelink-uploads/' || p.object_path))
            = '/storage/v1/object/public/carelink-uploads/' || p.object_path;
        IF matched_count <> 1 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Registration photo manifest mismatch';
        END IF;
      END IF;
      INSERT INTO public.facility_photos(facility_id,photo_url,photo_type,sort_order)
        VALUES(new_id,photo.url,CASE WHEN photo_slot=0 THEN 'exterior'
          WHEN photo_slot BETWEEN 1 AND 3 THEN 'interior'
          WHEN photo_slot BETWEEN 4 AND 6 THEN 'menu' ELSE 'other' END,photo.ordinality-1);
    END LOOP;
    INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
      VALUES(p_user_id,new_id,'update','salons',selected_id::text,
        jsonb_build_object('claimed_facility_id',new_id,'claimed_by_user_id',p_user_id));
  END IF;
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_user_id,new_id,'create','facility_profiles',new_id::text,
      jsonb_build_object('license_warranted',true,'terms_article','第12条','attestation_schema_version',1));
  INSERT INTO public.webhook_retry_queue(webhook_type,target_id,payload)
    VALUES('facility_welcome',new_id::text,jsonb_build_object('user_id',p_user_id::text,'template_version',1));
  -- Every failure escapes, rolling back profile, owner, claim, photos, audit and
  -- notification together. No success response follows a compensating delete.
  RETURN QUERY SELECT 'created'::text,new_id,new_slug;
END;
$$;
REVOKE ALL ON FUNCTION public.setup_facility_from_registration(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setup_facility_from_registration(uuid,text,uuid,uuid,text,timestamptz,jsonb,boolean)
  TO service_role;
COMMIT;
