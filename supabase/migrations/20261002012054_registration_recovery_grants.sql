-- Forward-only recovery; never reset the original intent capability or claim.
CREATE TABLE public.salon_recovery_grants (
  id uuid PRIMARY KEY,
  -- Auth account deletion invalidates the capability without deleting its
  -- receipt/tombstone or blocking the existing account-deletion workflow.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  receipt_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE RESTRICT,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = created_at + interval '72 hours')
);
ALTER TABLE public.salon_recovery_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_recovery_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.salon_recovery_grants TO service_role;
CREATE INDEX salons_recovery_email_id ON public.salons ((lower(btrim(email))), id);

-- Tiny service-only Auth boundary: no broad Auth read grant, email return,
-- user metadata authorization, or Gmail dot/plus alias inference.
CREATE FUNCTION public.registration_verified_account(p_user_id uuid, p_receipt_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_email text; confirmed timestamptz; applicant_email text;
BEGIN
  SELECT u.email,u.email_confirmed_at INTO account_email,confirmed
    FROM auth.users u WHERE u.id=p_user_id FOR SHARE;
  IF NOT FOUND OR confirmed IS NULL OR account_email IS NULL OR btrim(account_email)='' THEN RETURN false; END IF;
  IF p_receipt_id IS NULL THEN RETURN true; END IF;
  SELECT s.email INTO applicant_email FROM public.salons s WHERE s.id=p_receipt_id;
  RETURN coalesce(applicant_email IS NOT NULL AND btrim(applicant_email)<>''
    AND lower(btrim(applicant_email))=lower(btrim(account_email)), false);
END;
$$;
REVOKE ALL ON FUNCTION public.registration_verified_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registration_verified_account(uuid,uuid) TO service_role;

CREATE FUNCTION public.list_recoverable_salon_receipts(p_user_id uuid,p_after_id uuid DEFAULT NULL)
RETURNS TABLE(receipt_id uuid,facility_name text,business_type text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_email text; confirmed timestamptz;
BEGIN
  SELECT u.email,u.email_confirmed_at INTO account_email,confirmed
    FROM auth.users u WHERE u.id=p_user_id FOR SHARE;
  IF NOT FOUND OR confirmed IS NULL OR account_email IS NULL OR btrim(account_email)='' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='REGISTRATION_ACCOUNT_UNVERIFIED';
  END IF;
  RETURN QUERY SELECT s.id,s.facility_name,s.business_type,s.created_at
    FROM public.salons s WHERE lower(btrim(s.email))=lower(btrim(account_email))
      AND s.source='register' AND s.status IS DISTINCT FROM 'rejected'
      AND ((s.claimed_by_user_id IS NULL AND s.claimed_at IS NULL AND s.claimed_facility_id IS NULL)
        OR s.claimed_by_user_id=p_user_id)
      AND (p_after_id IS NULL OR s.id>p_after_id) ORDER BY s.id LIMIT 51;
END;
$$;
REVOKE ALL ON FUNCTION public.list_recoverable_salon_receipts(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_recoverable_salon_receipts(uuid,uuid) TO service_role;

CREATE FUNCTION public.prepare_salon_recovery(p_user_id uuid,p_receipt_id uuid,p_grant_id uuid,p_proof_hash text)
RETURNS TABLE(outcome text,grant_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE receipt public.salons%ROWTYPE; issued timestamptz; existing public.salon_recovery_grants%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_receipt_id IS NULL OR p_grant_id IS NULL
    OR p_proof_hash IS NULL OR p_proof_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-setup:'||p_user_id::text,0));
  IF NOT public.registration_verified_account(p_user_id) THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO receipt FROM public.salons WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT public.registration_verified_account(p_user_id,p_receipt_id)
    OR receipt.source IS DISTINCT FROM 'register' OR receipt.status='rejected'
    OR (receipt.claimed_by_user_id IS NOT NULL AND receipt.claimed_by_user_id<>p_user_id)
    OR (receipt.claimed_by_user_id IS NULL AND (receipt.claimed_at IS NOT NULL OR receipt.claimed_facility_id IS NOT NULL)) THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO existing FROM public.salon_recovery_grants WHERE id=p_grant_id;
  IF FOUND THEN
    IF existing.user_id=p_user_id AND existing.receipt_id=p_receipt_id
      AND existing.proof_hash=p_proof_hash AND existing.expires_at>clock_timestamp() THEN
      RETURN QUERY SELECT 'prepared'::text,existing.id,existing.expires_at;
    ELSE RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::timestamptz; END IF;
    RETURN;
  END IF;
  issued:=clock_timestamp();
  INSERT INTO public.salon_recovery_grants(id,user_id,receipt_id,proof_hash,created_at,expires_at)
    VALUES(p_grant_id,p_user_id,p_receipt_id,p_proof_hash,issued,issued+interval '72 hours');
  RETURN QUERY SELECT 'prepared'::text,p_grant_id,issued+interval '72 hours';
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_salon_recovery(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_salon_recovery(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.read_salon_recovery(p_user_id uuid,p_grant_id uuid,p_proof_hash text)
RETURNS TABLE(outcome text,receipt_id uuid,facility_name text,business_type text,address text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE grant_row public.salon_recovery_grants%ROWTYPE; receipt public.salons%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-setup:'||p_user_id::text,0));
  IF NOT public.registration_verified_account(p_user_id) THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text,NULL::text,NULL::text; RETURN;
  END IF;
  SELECT * INTO grant_row FROM public.salon_recovery_grants g
    WHERE g.id=p_grant_id AND g.user_id=p_user_id AND g.proof_hash=p_proof_hash;
  IF NOT FOUND OR grant_row.created_at>clock_timestamp() OR grant_row.expires_at<=clock_timestamp() THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text,NULL::text,NULL::text; RETURN;
  END IF;
  SELECT * INTO receipt FROM public.salons WHERE id=grant_row.receipt_id FOR SHARE;
  IF NOT FOUND OR NOT public.registration_verified_account(p_user_id,grant_row.receipt_id)
    OR grant_row.expires_at<=clock_timestamp()
    OR receipt.source IS DISTINCT FROM 'register' OR receipt.status='rejected'
    OR (receipt.claimed_by_user_id IS NOT NULL AND receipt.claimed_by_user_id<>p_user_id) THEN
    RETURN QUERY SELECT 'unverified'::text,NULL::uuid,NULL::text,NULL::text,NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'confirmed'::text,receipt.id,receipt.facility_name,receipt.business_type,receipt.address;
END;
$$;
REVOKE ALL ON FUNCTION public.read_salon_recovery(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_salon_recovery(uuid,uuid,text) TO service_role;

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
