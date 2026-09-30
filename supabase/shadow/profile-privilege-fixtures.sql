-- Synthetic identities only; everything is rolled back. Never run on hosted DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_profile_guard(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'profile guard fixture: %', label; END IF;
END $$;

INSERT INTO auth.users(id,email) VALUES
  ('78000000-0000-4000-8000-000000000001','profile-guard-one@example.invalid'),
  ('78000000-0000-4000-8000-000000000002','profile-guard-two@example.invalid');
SELECT pg_temp.assert_profile_guard((SELECT count(*)=2 FROM public.profiles
  WHERE id IN ('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000002')
    AND NOT is_platform_admin AND role IS NULL),'trusted signup retained');
DELETE FROM public.profiles WHERE id IN
  ('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000002');
-- Emulate the actual JWT identity used by RLS, never a client-selected role.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.profiles(id,is_platform_admin)
      VALUES('78000000-0000-4000-8000-000000000001',true);
    RAISE EXCEPTION 'platform privilege INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.profiles(id,role)
      VALUES('78000000-0000-4000-8000-000000000001','admin');
    RAISE EXCEPTION 'role privilege INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.profiles(id,is_platform_admin)
      VALUES('78000000-0000-4000-8000-000000000001',NULL);
    RAISE EXCEPTION 'NULL privilege INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.profiles(id)
      VALUES('78000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'other identity INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO public.profiles(id,display_name)
  VALUES('78000000-0000-4000-8000-000000000001','Synthetic recovered profile');
SELECT pg_temp.assert_profile_guard((SELECT NOT is_platform_admin AND role IS NULL
  FROM public.profiles WHERE id='78000000-0000-4000-8000-000000000001'),'own unprivileged recovery');
UPDATE public.profiles SET display_name='Synthetic edited profile'
  WHERE id='78000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_profile_guard((SELECT display_name='Synthetic edited profile'
  FROM public.profiles WHERE id='78000000-0000-4000-8000-000000000001'),'normal profile update retained');
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET is_platform_admin=true
      WHERE id='78000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'existing UPDATE privilege guard regressed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'permission denied:%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO public.profiles(id,is_platform_admin,role)
  VALUES('78000000-0000-4000-8000-000000000002',true,'admin');
SELECT pg_temp.assert_profile_guard((SELECT is_platform_admin AND role='admin'
  FROM public.profiles WHERE id='78000000-0000-4000-8000-000000000002'),'trusted provision retained');
RESET ROLE;
ROLLBACK;
