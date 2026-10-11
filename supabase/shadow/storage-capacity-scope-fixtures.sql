-- Read/write policy proof in the disposable database; no physical objects.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' AND NOT (current_database()='postgres'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')) THEN
    RAISE EXCEPTION 'isolated Supabase/PG17 shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id='f8700000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'synthetic namespace collision';
  END IF;
  -- The schema-only bootstrap has no JWT reader, Storage grants or active RLS.
  -- Restore real request semantics only inside this rolled-back fixture.
  IF current_database() LIKE 'carelink_shadow%' THEN
    EXECUTE $uid$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      SECURITY INVOKER SET search_path='' AS $claim$
        SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
          nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
      $claim$ $uid$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_storage_scope(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'storage scope fixture failed: %',label;END IF;END $$;
SELECT pg_temp.assert_storage_scope((SELECT file_size_limit<=10485760 AND file_size_limit>0 FROM storage.buckets WHERE id='carelink-uploads'),'positive bounded capacity');
SELECT pg_temp.assert_storage_scope(NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='review_photos_auth_insert'),'no permissive legacy review bypass');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('f8700000-0000-4000-8000-000000000001','storage-policy@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('f8710000-0000-4000-8000-000000000001','Synthetic storage policy','storage-policy-fixture','その他','検証県','検証市','検証住所','published');
INSERT INTO storage.buckets(id,name,public) VALUES('avatars','avatars',true),('review-photos','review-photos',true) ON CONFLICT(id) DO NOTHING;
SELECT set_config('request.jwt.claim.sub','f8700000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('avatars','f8700000-0000-4000-8000-000000000001/policy.png','f8700000-0000-4000-8000-000000000001');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('review-photos','reviews/f8710000-0000-4000-8000-000000000001/policy.png','f8700000-0000-4000-8000-000000000001');
DO $$ BEGIN
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('review-photos','outside-facility/bypass.png','f8700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'legacy review bypass survived';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('avatars','another-user/policy.png','f8700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'cross-owner avatar inserted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM auth.users WHERE id='f8700000-0000-4000-8000-000000000001';
-- Keep the stale JWT sub. It remains cryptographically valid in real Auth.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('avatars','f8700000-0000-4000-8000-000000000001/after-retirement.png','f8700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'retired avatar write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('review-photos','reviews/f8710000-0000-4000-8000-000000000001/after-retirement.png','f8700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'retired review write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_storage_scope(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='f8700000-0000-4000-8000-000000000001'),'retired identity removed');
-- The real Storage DELETE endpoint is verified separately: managed Storage
-- intentionally blocks raw SQL DELETE even when RLS would affect zero rows.
ROLLBACK;
