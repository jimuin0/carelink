-- Synthetic Auth/profile invariants only. Never applied to a hosted database.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT IN ('carelink_shadow','postgres')
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
    THEN RAISE EXCEPTION 'isolated PG17 database required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ef710000-%')
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id::text LIKE 'ef710000-%')
    THEN RAISE EXCEPTION 'synthetic signup fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_signup(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'signup profile fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_signup((SELECT prosecdef AND proconfig=ARRAY['search_path=public, extensions, pg_temp']
  AND prosrc !~* 'EXCEPTION[[:space:]]+WHEN[[:space:]]+OTHERS'
  FROM pg_proc WHERE oid='public.handle_new_user()'::regprocedure),'definer/search_path and propagating failure');
SELECT pg_temp.assert_signup(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
  AND tgname='on_auth_user_created' AND tgfoid='public.handle_new_user()'::regprocedure
  AND tgtype=5 AND tgenabled IN ('O','A')),'existing Auth INSERT trigger retained');

CREATE FUNCTION pg_temp.fail_signup_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.id='ef710000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'SYNTHETIC_PROFILE_INSERT_FAILURE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_signup_profile_failure BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_signup_profile();
DO $$ BEGIN
  BEGIN
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('ef710000-0000-4000-8000-000000000001','signup-failure@example.invalid','{"display_name":"Synthetic failure"}');
    RAISE EXCEPTION 'PROFILE_FAILURE_SWALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SYNTHETIC_PROFILE_INSERT_FAILURE' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_signup(NOT EXISTS(SELECT 1 FROM auth.users WHERE id='ef710000-0000-4000-8000-000000000001')
    AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000001'),
    'profile failure rolls back Auth row rather than succeeding without profile');
END $$;
DROP TRIGGER synthetic_signup_profile_failure ON public.profiles;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('ef710000-0000-4000-8000-000000000002','signup-password@example.invalid',
    '{"display_name":"Synthetic password","full_name":"Unused full","name":"Unused name","avatar_url":"https://example.invalid/avatar.png","phone":"09012345678","prefecture":"検証県","role":"admin","is_platform_admin":true}'),
  ('ef710000-0000-4000-8000-000000000003','signup-oauth-full@example.invalid',
    '{"display_name":"","full_name":"Synthetic full","name":"Unused name","avatar_url":""}'),
  ('ef710000-0000-4000-8000-000000000004','signup-oauth-name@example.invalid',
    '{"display_name":"","full_name":"","name":"Synthetic name"}'),
  ('ef710000-0000-4000-8000-000000000005','signup-email-fallback@example.invalid','{}'),
  ('ef710000-0000-4000-8000-000000000006',NULL,NULL),
  ('ef710000-0000-4000-8000-000000000007','signup-current-types@example.invalid',
    '{"display_name":42,"phone":123,"prefecture":false,"avatar_url":42,"role":"admin","is_platform_admin":true}');
SELECT pg_temp.assert_signup((SELECT display_name='Synthetic password' AND email='signup-password@example.invalid'
    AND avatar_url='https://example.invalid/avatar.png' AND phone='09012345678' AND prefecture='検証県'
    AND role IS NULL AND is_platform_admin IS FALSE
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000002'),
  'password fields retained; user metadata cannot grant platform privilege');
SELECT pg_temp.assert_signup((SELECT display_name='Synthetic full' AND avatar_url IS NULL
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000003'),'OAuth full_name and empty avatar');
SELECT pg_temp.assert_signup((SELECT display_name='Synthetic name'
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000004'),'OAuth name fallback');
SELECT pg_temp.assert_signup((SELECT display_name='signup-email-fallback'
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000005'),'email-local-part fallback');
SELECT pg_temp.assert_signup((SELECT display_name='' AND email IS NULL AND phone IS NULL AND prefecture IS NULL
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000006'),'null metadata/email retain existing empty fallback');
SELECT pg_temp.assert_signup((SELECT display_name='42' AND phone='123' AND prefecture='false' AND avatar_url='42'
    AND role IS NULL AND is_platform_admin IS FALSE
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000007'),'current text extraction types preserved without privilege inference');
SELECT pg_temp.assert_signup(NOT EXISTS(SELECT 1 FROM public.facility_members WHERE user_id::text LIKE 'ef710000-%'),
  'metadata does not manufacture owner/admin membership');

DO $$ BEGIN
  BEGIN
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('ef710000-0000-4000-8000-000000000002','signup-duplicate@example.invalid','{"display_name":"Overwrite attempt"}');
    RAISE EXCEPTION 'duplicate Auth id accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM pg_temp.assert_signup((SELECT email='signup-password@example.invalid' FROM auth.users
    WHERE id='ef710000-0000-4000-8000-000000000002')
    AND (SELECT display_name='Synthetic password' FROM public.profiles
    WHERE id='ef710000-0000-4000-8000-000000000002'),'duplicate Auth id leaves original Auth/profile unchanged');
END $$;

-- Exercise the retained ON CONFLICT without disabling a managed Auth trigger
-- or changing a foreign key. This temporary trigger supplies the same NEW
-- shape for an already existing Auth/profile id, entirely within this fixture.
CREATE TEMP TABLE synthetic_signup_replay(id uuid,email text,raw_user_meta_data jsonb);
CREATE TRIGGER synthetic_signup_replay AFTER INSERT ON synthetic_signup_replay
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO synthetic_signup_replay VALUES
  ('ef710000-0000-4000-8000-000000000002','signup-replay@example.invalid','{"display_name":"Overwrite attempt"}');
SELECT pg_temp.assert_signup((SELECT display_name='Synthetic password' AND email='signup-password@example.invalid'
  FROM public.profiles WHERE id='ef710000-0000-4000-8000-000000000002'),'profile id conflict remains DO NOTHING, never overwrites legacy rows');
SELECT 'Auth/profile transaction, metadata and privilege checks passed';
ROLLBACK;
