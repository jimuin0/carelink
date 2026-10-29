-- Synthetic data, isolated shadow database only; transaction always rolls back.
BEGIN;
SET LOCAL statement_timeout = '5s';
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fb510000-0000-4000-8000-000000000001','listing-owner@example.invalid',now()),
 ('fb510000-0000-4000-8000-000000000002','listing-operator@example.invalid',now()),
 ('fb510000-0000-4000-8000-000000000003','listing-other@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='fb510000-0000-4000-8000-000000000002';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours,latitude,longitude,medical_specialties)
VALUES('fb510000-0000-4000-8000-000000000004','Synthetic','synthetic-listing-review','内科','検証県','検証市','検証住所','draft',
  '{"mon":{"open":"09:00","close":"18:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}',
  34.7,135.5,ARRAY['内科','耳鼻咽喉科']);
INSERT INTO public.facility_members(facility_id,user_id,role)
VALUES('fb510000-0000-4000-8000-000000000004','fb510000-0000-4000-8000-000000000001','owner');
DO $$ DECLARE p record; fid uuid := 'fb510000-0000-4000-8000-000000000004';
owner_id uuid := 'fb510000-0000-4000-8000-000000000001'; operator_id uuid := 'fb510000-0000-4000-8000-000000000002';
doc_id uuid := 'fb510000-0000-4000-8000-000000000005'; object_name text;
identity jsonb := '{"name":"Synthetic","prefecture":"検証県","city":"検証市","address":"検証住所"}'::jsonb;
BEGIN
  BEGIN
    UPDATE public.facility_profiles SET status='published' WHERE id=fid;
    RAISE EXCEPTION 'unverified publication accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%published_listing_verification_required%' THEN RAISE; END IF;
  END;
  SELECT * INTO p FROM public.prepare_listing_verification_document('fb510000-0000-4000-8000-000000000003',fid,doc_id,'lease','application/pdf',5,repeat('a',64));
  IF p.outcome <> 'unverified' THEN RAISE EXCEPTION 'nonmember document accepted'; END IF;
  SELECT * INTO p FROM public.prepare_listing_verification_document(owner_id,fid,doc_id,'lease','application/pdf',5,repeat('a',64));
  IF p.outcome <> 'prepared' THEN RAISE EXCEPTION 'owner preparation failed'; END IF;
  object_name := p.object_path;
  SELECT * INTO p FROM public.prepare_listing_verification_document(owner_id,fid,doc_id,'lease','application/pdf',5,repeat('b',64));
  IF p.outcome <> 'conflict' THEN RAISE EXCEPTION 'changed retry accepted'; END IF;
  INSERT INTO storage.objects(bucket_id,name) VALUES('listing-verification',object_name);
  BEGIN
    PERFORM public.approve_listing_verification(operator_id,fid,ARRAY[doc_id],identity,true,false);
    RAISE EXCEPTION 'missing authority confirmation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'LISTING_VERIFICATION_CONFIRMATION_REQUIRED%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.approve_listing_verification(owner_id,fid,ARRAY[doc_id],identity,true,true);
    RAISE EXCEPTION 'nonoperator review accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.approve_listing_verification(operator_id,fid,ARRAY[doc_id],identity || '{"address":"旧住所"}'::jsonb,true,true);
    RAISE EXCEPTION 'stale identity accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'LISTING_VERIFICATION_IDENTITY_CHANGED%' THEN RAISE; END IF; END;
  IF NOT public.approve_listing_verification(operator_id,fid,ARRAY[doc_id],identity,true,true) THEN RAISE EXCEPTION 'approval failed'; END IF;
  UPDATE public.facility_profiles SET status='published' WHERE id=fid;
  IF NOT EXISTS (SELECT 1 FROM public.facility_card_view WHERE id=fid AND medical_specialties @> ARRAY['耳鼻咽喉科']) THEN
    RAISE EXCEPTION 'secondary specialty missing from card'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_facilities_nearby(34.7,135.5,10,'耳鼻咽喉科',100,NULL,NULL) WHERE id=fid) THEN
    RAISE EXCEPTION 'secondary specialty missing from GPS search'; END IF;
  BEGIN
    UPDATE public.facility_profiles SET address='別住所' WHERE id=fid;
    RAISE EXCEPTION 'identity change accepted';
  EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%published_listing_verification_required%' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
