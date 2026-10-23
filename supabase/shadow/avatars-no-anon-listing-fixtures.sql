-- Disposable PG17 shadow only. Synthetic rows, rolled back; no physical objects.
-- 20261023190100_avatars_no_anon_listing.sql:
--   Anonymous visitors cannot list the avatars bucket (which handed out every member's account id),
--   members still read and write only their own folder, and a live member can delete objects in
--   their own folder (the profile page removes the previous photo after switching to a randomly
--   named one).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id::text LIKE 'fe700000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
  -- The schema-only bootstrap has no JWT reader, Storage grants or active RLS.
  -- Restore real request semantics only inside this rolled-back fixture.
  EXECUTE $uid$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    SECURITY INVOKER SET search_path='' AS $claim$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $claim$ $uid$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT SELECT ON storage.objects TO anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
END $$;
CREATE FUNCTION pg_temp.assert_avatars(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'avatars listing fixture failed: %', label; END IF; END $$;

-- Policy set: no anonymous read, owner-scoped read/write/delete.
SELECT pg_temp.assert_avatars(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname = 'Public read avatars'), 'the anonymous read policy is gone');
SELECT pg_temp.assert_avatars(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('SELECT', 'ALL') AND roles && ARRAY['anon', 'public']::name[] AND coalesce(qual, '') LIKE '%''avatars''%'),
  'no anonymous or public policy reads the avatars bucket');
SELECT pg_temp.assert_avatars(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('SELECT', 'ALL') AND roles && ARRAY['anon', 'public']::name[] AND coalesce(qual, '') LIKE '%''review-photos''%'),
  'no anonymous or public policy reads the review-photos bucket');
SELECT pg_temp.assert_avatars((SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname IN ('avatars_insert_own', 'avatars_select_own_live', 'avatars_update_own', 'avatars_delete_own')),
  'owner-scoped insert, read, update and delete policies exist');
SELECT pg_temp.assert_avatars((SELECT cmd = 'DELETE' AND roles = ARRAY['authenticated']::name[] FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_delete_own'),
  'the delete policy is for signed-in members only');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe700000-0000-4000-8000-000000000001', 'avatar-owner@example.invalid', now()),
 ('fe700000-0000-4000-8000-000000000002', 'avatar-other@example.invalid', now());
INSERT INTO storage.buckets(id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
-- Existing photo under the old guessable name, a new randomly named one, and another member's photo.
INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES
 ('avatars', 'fe700000-0000-4000-8000-000000000001/avatar.jpg', 'fe700000-0000-4000-8000-000000000001'),
 ('avatars', 'fe700000-0000-4000-8000-000000000001/fe7a0000-0000-4000-8000-000000000001.png', 'fe700000-0000-4000-8000-000000000001'),
 ('avatars', 'fe700000-0000-4000-8000-000000000002/avatar.png', 'fe700000-0000-4000-8000-000000000002');

-- Anonymous visitors (the Storage API list with the anon key) see nothing.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_avatars((SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'avatars'),
  'anonymous listing returns no avatar (before: every member''s account id)');
RESET ROLE;

-- A member sees and deletes only their own folder.
SELECT set_config('request.jwt.claim.sub', 'fe700000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_avatars((SELECT count(*) = 2 FROM storage.objects WHERE bucket_id = 'avatars')
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'fe700000-0000-4000-8000-000000000002/%'),
  'a member reads only their own folder');
INSERT INTO storage.objects(bucket_id, name, owner_id)
 VALUES ('avatars', 'fe700000-0000-4000-8000-000000000001/fe7a0000-0000-4000-8000-000000000002.webp', 'fe700000-0000-4000-8000-000000000001');
DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = 'fe700000-0000-4000-8000-000000000001/avatar.jpg';
DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = 'fe700000-0000-4000-8000-000000000002/avatar.png';
RESET ROLE;
SELECT pg_temp.assert_avatars(NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'avatars'
  AND name = 'fe700000-0000-4000-8000-000000000001/avatar.jpg'), 'a member deletes their own previous photo');
SELECT pg_temp.assert_avatars(EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'avatars'
  AND name = 'fe700000-0000-4000-8000-000000000002/avatar.png'), 'another member''s photo cannot be deleted');

-- A deleted account's still-valid JWT cannot delete either (same live-profile rule as insert/update).
DELETE FROM auth.users WHERE id = 'fe700000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'fe700000-0000-4000-8000-000000000001/%';
RESET ROLE;
SELECT pg_temp.assert_avatars((SELECT count(*) = 2 FROM storage.objects WHERE bucket_id = 'avatars'
  AND name LIKE 'fe700000-0000-4000-8000-000000000001/%'), 'a retired account cannot delete through RLS');

SELECT 'avatars cannot be listed anonymously; members manage only their own folder';
ROLLBACK;
