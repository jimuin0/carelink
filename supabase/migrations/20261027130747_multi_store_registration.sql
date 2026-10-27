-- Owner may manage multiple stores; receipt selection remains authenticated and atomic.
BEGIN;
DROP INDEX public.uq_facility_members_one_owner_per_user;

CREATE OR REPLACE FUNCTION public.setup_facility_from_registration(
  p_user_id uuid, p_claim_mode text, p_receipt_id uuid, p_intent_id uuid,
  p_proof_hash text, p_legacy_issued_at timestamptz, p_profile jsonb,
  p_license_warranted boolean
) RETURNS TABLE(outcome text, facility_id uuid, facility_slug text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  receipt public.salons%ROWTYPE;
  intent public.salon_submission_intents%ROWTYPE;
  recovery public.salon_recovery_grants%ROWTYPE;
  linked public.salon_duplicate_links%ROWTYPE;
  source_intent_id uuid;
  existing_id uuid;
  selected_id uuid;
  new_id uuid;
  new_slug text;
  new_name text;
  new_business_type text;
  photo record;
  normalized_location record;
  new_prefecture text;
  photo_slot smallint;
  matched_count integer;
BEGIN
  IF p_user_id IS NULL OR p_license_warranted IS DISTINCT FROM true
    OR p_claim_mode IS NULL OR p_claim_mode NOT IN ('none','legacy','intent','recovered')
    OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR p_profile - ARRAY['facility_name','business_type','phone','prefecture','city','address'] <> '{}'::jsonb
    OR EXISTS (SELECT 1 FROM jsonb_each(p_profile) v WHERE jsonb_typeof(v.value) <> 'string') THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN;
  END IF;
  -- Fixed recovery order: user -> Auth row -> immutable grant -> intent -> receipt.
  -- Anonymous capability paths keep user -> intent -> receipt. No broad Auth
  -- read privilege is required; the service-only helper owns that boundary.
  -- Serialize setup for this user even when several verified receipts are submitted.
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-setup:' || p_user_id::text, 0));
  -- Lock the account before any receipt in every mode; only recovered/linked
  -- authorization requires confirmation, so existing ordinary setup stays intact.
  PERFORM public.registration_verified_account(p_user_id);
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
    source_intent_id := intent.id;
  ELSIF p_claim_mode = 'recovered' THEN
    IF p_receipt_id IS NOT NULL OR p_legacy_issued_at IS NOT NULL
      OR NOT public.registration_verified_account(p_user_id) THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    SELECT * INTO recovery FROM public.salon_recovery_grants
      WHERE id=p_intent_id AND user_id=p_user_id AND proof_hash=p_proof_hash;
    IF NOT FOUND OR recovery.created_at>clock_timestamp() OR recovery.expires_at<=clock_timestamp() THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    selected_id := recovery.receipt_id;
    SELECT * INTO intent FROM public.salon_submission_intents WHERE salon_id=selected_id FOR UPDATE;
    IF FOUND THEN
      IF intent.canonical_version<>1 OR intent.hmac_scheme<>'proof-hkdf-sha256-v1' THEN
        RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
      END IF;
      source_intent_id := intent.id;
    END IF;
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
    IF p_claim_mode='recovered' AND (recovery.expires_at<=clock_timestamp()
      OR receipt.source IS DISTINCT FROM 'register'
      OR NOT public.registration_verified_account(p_user_id,selected_id)) THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    -- Recheck lifetime after the receipt lock too: another user can hold it.
    IF (p_claim_mode='legacy' AND p_legacy_issued_at + interval '72 hours' <= clock_timestamp())
      OR (p_claim_mode='intent' AND intent.created_at + interval '72 hours' <= clock_timestamp()) THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    SELECT * INTO linked FROM public.salon_duplicate_links WHERE duplicate_receipt_id=selected_id;
    IF FOUND THEN
      -- Never lock a canonical receipt/intent from here: receipt lock order
      -- would reverse the sorted pair order of the linker. Immutable owner
      -- binding plus current membership protects the returned facility.
      IF linked.owner_id IS DISTINCT FROM p_user_id
        OR NOT public.registration_verified_account(p_user_id,selected_id) THEN
        RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text; RETURN;
      END IF;
      PERFORM 1 FROM public.facility_members m WHERE m.facility_id=linked.facility_id
        AND m.user_id=p_user_id AND m.role='owner' FOR SHARE;
      IF NOT FOUND THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text; RETURN; END IF;
      RETURN QUERY SELECT 'linked'::text,p.id,p.slug FROM public.facility_profiles p
        WHERE p.id=linked.facility_id FOR SHARE;
      RETURN;
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
    -- Existing users can only add a separately selected, verified receipt.
    -- Never let the ordinary onboarding form create another unkeyed facility.
    IF selected_id IS NULL THEN
      RETURN QUERY SELECT 'already_member'::text,p.id,p.slug FROM public.facility_profiles p WHERE p.id=existing_id;
      RETURN;
    END IF;
    IF receipt.source IS DISTINCT FROM 'register' OR NOT public.registration_verified_account(p_user_id, selected_id) THEN
      RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    IF (SELECT count(*) FROM public.facility_members m
        WHERE m.user_id=p_user_id AND m.role IN ('owner','admin')) >= 100 THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    -- Additional stores retain their verified receipt fields, not client edits.
    -- Block a repeated same-name, same-location receipt for this owner; missing
    -- locations fail closed for matching names rather than inventing identity.
    SELECT * INTO normalized_location FROM public.normalize_facility_location(
      coalesce(receipt.prefecture,''), coalesce(receipt.city,''), coalesce(receipt.address,''));
    IF EXISTS (
      SELECT 1 FROM public.salons prior
      WHERE prior.claimed_by_user_id=p_user_id AND prior.claimed_facility_id IS NOT NULL
        AND lower(regexp_replace(btrim(prior.facility_name), '[[:space:]　]+', '', 'g'))
          = lower(regexp_replace(btrim(receipt.facility_name), '[[:space:]　]+', '', 'g'))
        AND (nullif(btrim(prior.address),'') IS NULL OR nullif(btrim(receipt.address),'') IS NULL
          OR lower(regexp_replace(btrim(prior.address), '[[:space:]　]+', '', 'g'))
            = lower(regexp_replace(btrim(receipt.address), '[[:space:]　]+', '', 'g')))
    ) OR EXISTS (
      SELECT 1 FROM public.facility_members m JOIN public.facility_profiles p ON p.id=m.facility_id
      WHERE m.user_id=p_user_id AND m.role IN ('owner','admin')
        AND lower(regexp_replace(btrim(p.name), '[[:space:]　]+', '', 'g'))
          = lower(regexp_replace(btrim(receipt.facility_name), '[[:space:]　]+', '', 'g'))
        AND (nullif(btrim(p.address),'') IS NULL OR nullif(btrim(receipt.address),'') IS NULL
          OR (p.prefecture=coalesce(receipt.prefecture,'') AND p.city=normalized_location.city
            AND lower(regexp_replace(btrim(p.address), '[[:space:]　]+', '', 'g'))
              = lower(regexp_replace(btrim(normalized_location.address), '[[:space:]　]+', '', 'g'))))
    ) THEN
      RETURN QUERY SELECT 'conflict'::text,NULL::uuid,NULL::text; RETURN;
    END IF;
    p_profile:='{}'::jsonb;
  END IF;
  -- Recovery preserves the original receipt. Edits belong to the subsequent
  -- authorized settings form, not this identity/receipt restoration boundary.
  IF p_claim_mode='recovered' THEN p_profile:='{}'::jsonb; END IF;
  -- Only the selected receipt supplies missing fields. Email by itself is not
  -- a capability; recovery also requires a confirmed account and bound grant.
  new_name := coalesce(nullif(p_profile->>'facility_name',''),receipt.facility_name);
  new_business_type := coalesce(nullif(p_profile->>'business_type',''),receipt.business_type);
  IF new_name IS NULL OR length(btrim(new_name))=0 OR length(new_name)>200
    OR new_business_type IS NULL OR new_business_type NOT IN
      ('ヘアサロン','ネイル・まつげサロン','リラクサロン','エステサロン','美容クリニック',
       '病院','総合病院','診療所・クリニック（複数診療科）','内科','呼吸器内科','循環器内科','消化器内科','糖尿病内科','腎臓内科','脳神経内科','外科','整形外科','脳神経外科','形成外科','小児科','耳鼻咽喉科','眼科','皮膚科','泌尿器科','産婦人科','婦人科','精神科','心療内科','アレルギー科','リウマチ科','リハビリテーション科','歯科','小児歯科','矯正歯科','歯科口腔外科','その他の医療機関',
       '鍼灸院・整骨院','ピラティス','その他') THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN;
  END IF;
  -- The receipt keeps the applicant's full address (prefecture + city + street)
  -- and the postcode lookup's city ("横浜市中区", "大阪市北区"). The public page
  -- prints prefecture || city || address and the area pages match the city
  -- master (src/data/city-slugs.ts), so store the street part only and the
  -- master's city unit. The receipt itself (and its HMAC) is not changed.
  new_prefecture := coalesce(nullif(p_profile->>'prefecture',''),receipt.prefecture,'');
  SELECT * INTO normalized_location FROM public.normalize_facility_location(new_prefecture,
    coalesce(nullif(p_profile->>'city',''),receipt.city,''),
    coalesce(nullif(p_profile->>'address',''),receipt.address,''));
  new_id := gen_random_uuid();
  new_slug := 'facility-' || new_id::text;
  INSERT INTO public.facility_profiles (
    id,name,slug,business_type,phone,prefecture,city,address,postal_code,building,
    nearest_station,business_hours_text,regular_holiday,seat_count,staff_count,
    parking,features,website_url,description,main_photo_url,status
  ) VALUES (
    new_id,new_name,new_slug,new_business_type,
    coalesce(nullif(p_profile->>'phone',''),receipt.phone),
    new_prefecture,normalized_location.city,normalized_location.address,
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
      IF source_intent_id IS NOT NULL THEN
        -- Commit stores immutable server-derived public paths. Recover the
        -- actual optional slot, not array index (slot zero may be absent).
        SELECT count(*), min(p.slot) INTO matched_count,photo_slot
          FROM public.salon_submission_photos p WHERE p.intent_id=source_intent_id
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
