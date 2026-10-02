-- Non-destructive receipt linkage, not a merge of facilities or capabilities.
CREATE TABLE public.salon_duplicate_links (
  duplicate_receipt_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE RESTRICT,
  canonical_receipt_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
  facility_id uuid NOT NULL REFERENCES public.facility_profiles(id) ON DELETE RESTRICT,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (duplicate_receipt_id<>canonical_receipt_id)
);
ALTER TABLE public.salon_duplicate_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_duplicate_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.salon_duplicate_links TO service_role;
CREATE INDEX salon_duplicate_links_canonical ON public.salon_duplicate_links(canonical_receipt_id);

CREATE FUNCTION public.link_duplicate_registration(
  p_actor uuid,p_duplicate uuid,p_canonical uuid,p_commit boolean,
  p_duplicate_revision integer,p_canonical_revision integer,p_same_site boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.salons%ROWTYPE; c public.salons%ROWTYPE;
  f public.facility_profiles%ROWTYPE; owner_id uuid; link public.salon_duplicate_links%ROWTYPE;
  preview jsonb;
  whitespace constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF p_actor IS NULL OR p_duplicate IS NULL OR p_canonical IS NULL OR p_duplicate=p_canonical
    OR p_commit IS NULL THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
  -- Auth locks precede receipt locks as in verified-account recovery. Account
  -- deletion takes the same parent lock before cascading into profile/claims.
  SELECT claimed_by_user_id INTO owner_id FROM public.salons WHERE id=p_canonical;
  IF owner_id IS NULL THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-setup:'||owner_id::text,0));
  PERFORM public.registration_verified_account(least(p_actor,owner_id));
  PERFORM public.registration_verified_account(greatest(p_actor,owner_id));
  IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
  IF NOT public.registration_verified_account(owner_id) THEN
    RETURN jsonb_build_object('outcome','conflict'); END IF;
  PERFORM 1 FROM public.salons WHERE id IN (p_duplicate,p_canonical) ORDER BY id FOR UPDATE;
  SELECT * INTO d FROM public.salons WHERE id=p_duplicate;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  SELECT * INTO c FROM public.salons WHERE id=p_canonical;
  IF NOT FOUND OR c.claimed_by_user_id IS DISTINCT FROM owner_id
    OR c.claimed_facility_id IS NULL OR c.claimed_at IS NULL
    OR c.source IS DISTINCT FROM 'register' OR d.source IS DISTINCT FROM 'register'
    OR c.status='rejected' OR d.status='rejected'
    OR d.claimed_facility_id IS NOT NULL OR d.claimed_at IS NOT NULL OR d.claimed_by_user_id IS NOT NULL
    OR NOT public.registration_verified_account(owner_id,p_canonical)
    OR NOT public.registration_verified_account(owner_id,p_duplicate) THEN
    RETURN jsonb_build_object('outcome','conflict'); END IF;
  -- Never follow alias chains, or convert an alias target into an alias.
  IF EXISTS(SELECT 1 FROM public.salon_duplicate_links WHERE duplicate_receipt_id=p_canonical
      OR canonical_receipt_id=p_duplicate) THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  PERFORM 1 FROM public.facility_members WHERE facility_id=c.claimed_facility_id
    AND user_id=owner_id AND role='owner' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE id=c.claimed_facility_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  -- Reconciliation is not a new linkage decision. Legitimate settings edits
  -- after commit must not hide the immutable exact-pair result after timeout.
  SELECT * INTO link FROM public.salon_duplicate_links WHERE duplicate_receipt_id=p_duplicate;
  IF FOUND THEN
    IF link.canonical_receipt_id<>p_canonical OR link.facility_id<>f.id OR link.owner_id IS DISTINCT FROM owner_id THEN
      RETURN jsonb_build_object('outcome','conflict'); END IF;
    RETURN jsonb_build_object('outcome','replay','facilityId',f.id);
  END IF;
  -- All required identity fields are present and identical in BOTH original
  -- receipts and the current facility. No fuzzy name/address/phone matching.
  IF EXISTS(SELECT 1 FROM (VALUES
      (d.facility_name,c.facility_name,f.name),(d.business_type,c.business_type,f.business_type),
      (d.prefecture,c.prefecture,f.prefecture),(d.city,c.city,f.city),(d.address,c.address,f.address)
    ) AS identities(a,b,v) WHERE a IS NULL OR b IS NULL OR v IS NULL OR btrim(a,whitespace)=''
      OR btrim(a,whitespace) IS DISTINCT FROM btrim(b,whitespace) OR btrim(b,whitespace) IS DISTINCT FROM btrim(v,whitespace))
    OR nullif(btrim(d.building_name,whitespace),'') IS DISTINCT FROM nullif(btrim(c.building_name,whitespace),'')
    OR nullif(btrim(c.building_name,whitespace),'') IS DISTINCT FROM nullif(btrim(f.building,whitespace),'')
    OR d.phone IS NULL OR c.phone IS NULL OR f.phone IS NULL
    OR regexp_replace(d.phone,'[ -]','','g') !~ '^[0-9]{10,11}$'
    OR regexp_replace(d.phone,'[ -]','','g') IS DISTINCT FROM regexp_replace(c.phone,'[ -]','','g')
    OR regexp_replace(c.phone,'[ -]','','g') IS DISTINCT FROM regexp_replace(f.phone,'[ -]','','g') THEN
    RETURN jsonb_build_object('outcome','conflict'); END IF;
  preview:=jsonb_build_object('outcome','preview','duplicateId',d.id,'canonicalId',c.id,
    'duplicateRevision',d.review_revision,'canonicalRevision',c.review_revision,
    'facilityId',f.id,'name',f.name,'businessType',f.business_type,'prefecture',f.prefecture,
    'city',f.city,'address',f.address,'building',f.building);
  IF NOT p_commit THEN RETURN preview; END IF;
  IF p_same_site IS DISTINCT FROM true OR p_duplicate_revision IS DISTINCT FROM d.review_revision
    OR p_canonical_revision IS DISTINCT FROM c.review_revision THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
  INSERT INTO public.salon_duplicate_links(duplicate_receipt_id,canonical_receipt_id,facility_id,owner_id,linked_by)
    VALUES(d.id,c.id,f.id,owner_id,p_actor);
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_actor,f.id,'create','salon_duplicate_links',d.id::text,
      jsonb_build_object('canonical_receipt_id',c.id,'facility_id',f.id,'same_site_confirmed',true));
  RETURN jsonb_build_object('outcome','linked','facilityId',f.id);
END;
$$;
REVOKE ALL ON FUNCTION public.link_duplicate_registration(uuid,uuid,uuid,boolean,integer,integer,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_duplicate_registration(uuid,uuid,uuid,boolean,integer,integer,boolean)
  TO service_role;

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
  -- The existing one-owner unique index remains authoritative for other writers.
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
    RETURN QUERY SELECT 'already_member'::text,p.id,p.slug FROM public.facility_profiles p WHERE p.id=existing_id;
    RETURN;
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
