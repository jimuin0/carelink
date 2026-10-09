-- Synthetic PG17 proof boundaries only. No LINE/Auth provider calls or sends.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT IN ('carelink_shadow','carelink_shadow_batch2_auth')
   OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'isolated LINE fixture required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'c9010000-%') THEN
   RAISE EXCEPTION 'synthetic LINE fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_line(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'LINE proof fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
SELECT ('c9010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'synthetic-line-'||n||'@example.invalid',now(),
 CASE WHEN n=4 THEN '{"carelink_line_identity_version":1,"carelink_line_user_id":"U_trusted"}'::jsonb ELSE '{}'::jsonb END,
 CASE WHEN n=3 THEN '{"line_user_id":"U_trusted","carelink_line_identity_version":1,"carelink_line_user_id":"U_trusted"}'::jsonb ELSE '{}'::jsonb END
FROM generate_series(1,5) n;
INSERT INTO public.line_user_links(line_user_id,display_name) VALUES('U_legacy_null','Synthetic follower');
INSERT INTO public.line_user_links(user_id,line_user_id) VALUES('c9010000-0000-4000-8000-000000000002','U_legacy_owned');
UPDATE public.profiles SET line_user_id='U_legacy_owned' WHERE id='c9010000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_line((SELECT count(*)=2 AND bool_and(proof_version IS NULL AND verified_at IS NULL)
 FROM public.line_user_links WHERE line_user_id IN ('U_legacy_null','U_legacy_owned')),'no inferred legacy proof');
SELECT pg_temp.assert_line(NOT has_table_privilege('authenticated','public.line_user_links','INSERT')
 AND NOT has_table_privilege('authenticated','public.line_user_links','UPDATE')
 AND NOT has_function_privilege('authenticated','public.bind_verified_liff_account_atomic(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.find_trusted_line_auth_user(text)','EXECUTE')
 AND has_function_privilege('service_role','public.bind_verified_liff_account_atomic(uuid,text)','EXECUTE'),'service-only provider proof');

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_line(public.find_trusted_line_auth_user('U_trusted')='c9010000-0000-4000-8000-000000000004',
 'only app metadata identifies LINE-only retry, public metadata ignored');
SELECT pg_temp.assert_line(public.find_trusted_line_auth_user('U_unknown') IS NULL,'no trusted candidate remains unlinked');
RESET ROLE;
-- This is legal on the provider's Auth table: the app must fail closed rather
-- than assume an index that its ordinary migration role cannot create there.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('c9010000-0000-4000-8000-000000000006','synthetic-line-6@example.invalid',now(),'{"carelink_line_identity_version":1,"carelink_line_user_id":"U_ambiguous"}'),
 ('c9010000-0000-4000-8000-000000000007','synthetic-line-7@example.invalid',now(),'{"carelink_line_identity_version":1,"carelink_line_user_id":"U_ambiguous"}');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.find_trusted_line_auth_user('U_ambiguous'); RAISE EXCEPTION 'ambiguous Auth candidate selected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_AUTH_IDENTITY_AMBIGUOUS' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_line((SELECT count(*)=2 FROM auth.users WHERE id IN ('c9010000-0000-4000-8000-000000000006','c9010000-0000-4000-8000-000000000007'))
 AND NOT EXISTS(SELECT 1 FROM public.line_user_links WHERE user_id IN ('c9010000-0000-4000-8000-000000000006','c9010000-0000-4000-8000-000000000007')),
 'ambiguity retains both Auth records without guessing/deleting/binding');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_line(public.line_identity_requires_reconfirmation('U_legacy_owned')
 AND NOT public.line_identity_requires_reconfirmation('U_legacy_null'),'unowned follow row is not an existing Auth identity');
SELECT pg_temp.assert_line(public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000001','U_legacy_null')='linked',
 'live proof can bind an unowned legacy follower');
SELECT pg_temp.assert_line((SELECT user_id='c9010000-0000-4000-8000-000000000001' AND proof_version=1 AND verified_at IS NOT NULL
 AND display_name='Synthetic follower' FROM public.line_user_links WHERE line_user_id='U_legacy_null')
  AND (SELECT line_user_id='U_legacy_null' FROM public.profiles WHERE id='c9010000-0000-4000-8000-000000000001'),'both halves saved, follower metadata preserved');
-- The follow producer writes only these metadata columns. The PostgreSQL
-- conflict update preserves verified ownership rather than inserting NULLs.
INSERT INTO public.line_user_links(line_user_id,display_name,picture_url) VALUES('U_legacy_null','Synthetic refreshed follower',NULL)
 ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name,picture_url=excluded.picture_url;
SELECT pg_temp.assert_line((SELECT user_id='c9010000-0000-4000-8000-000000000001' AND proof_version=1 AND verified_at IS NOT NULL
 FROM public.line_user_links WHERE line_user_id='U_legacy_null'),'follow metadata update preserves verified ownership');
CREATE TEMP TABLE line_proof_before AS SELECT verified_at FROM public.line_user_links WHERE line_user_id='U_legacy_null';
SELECT pg_temp.assert_line(public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000001','U_legacy_null')='linked', 'same actor replay');
SELECT pg_temp.assert_line((SELECT verified_at=(SELECT verified_at FROM pg_temp.line_proof_before) FROM public.line_user_links
 WHERE line_user_id='U_legacy_null'),'replay keeps original proof time');
SELECT pg_temp.assert_line(public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000003','U_legacy_null')='conflict',
 'another actor cannot steal verified owner');
SELECT pg_temp.assert_line(public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000002','U_legacy_owned')='linked',
 'owned legacy row only verified by a live proof for the same current actor');
SELECT pg_temp.assert_line(public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000001','U_new_different')='conflict',
 'no automatic unlink/rebind');
DO $$ BEGIN
 BEGIN UPDATE public.profiles SET line_user_id='U_service_forged' WHERE id='c9010000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'old service profile-only binder accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_IDENTITY_REQUIRES_PROVIDER_PROOF' THEN RAISE; END IF; END;
 BEGIN UPDATE public.line_user_links SET user_id='c9010000-0000-4000-8000-000000000003' WHERE line_user_id='U_legacy_null'; RAISE EXCEPTION 'verified owner reassigned';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_VERIFIED_BINDING_IMMUTABLE' THEN RAISE; END IF; END;
 BEGIN UPDATE public.line_user_links SET proof_version=NULL,verified_at=NULL WHERE line_user_id='U_legacy_null'; RAISE EXCEPTION 'verified proof erased';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_VERIFIED_BINDING_IMMUTABLE' THEN RAISE; END IF; END;
 UPDATE public.profiles SET display_name='Synthetic service ordinary edit' WHERE id='c9010000-0000-4000-8000-000000000001';
 BEGIN PERFORM public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000099','U_absent');
   RAISE EXCEPTION 'retired actor accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_ACCOUNT_UNAVAILABLE' THEN RAISE; END IF; END;
 BEGIN PERFORM public.bind_verified_liff_account_atomic(NULL,'U_null'); RAISE EXCEPTION 'null actor accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_LINK_INPUT_INVALID' THEN RAISE; END IF; END;
 BEGIN PERFORM public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000003','invalid user'); RAISE EXCEPTION 'invalid identity accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_LINK_INPUT_INVALID' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

-- Failure after link write must roll it back together with the profile write.
CREATE FUNCTION pg_temp.fail_line_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='c9010000-0000-4000-8000-000000000005' THEN RAISE EXCEPTION 'SYNTHETIC_LINE_PROFILE_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_line_profile_failure BEFORE UPDATE OF line_user_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_line_profile();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.bind_verified_liff_account_atomic('c9010000-0000-4000-8000-000000000005','U_rollback'); RAISE EXCEPTION 'partial link saved';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_LINE_PROFILE_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_line(NOT EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='U_rollback')
 AND (SELECT line_user_id IS NULL FROM public.profiles WHERE id='c9010000-0000-4000-8000-000000000005'),'late profile failure rolls back link');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_line_profile_failure ON public.profiles;

-- Existing ordinary profile editing remains available, but direct LINE mutation
-- and direct authoritative ownership writes are refused under the actual role.
SELECT set_config('request.jwt.claim.sub','c9010000-0000-4000-8000-000000000003',true);
-- Minimal shadow bootstrap normally returns NULL. Only this rollback fixture
-- substitutes the provider's claim-based auth.uid to exercise real own RLS.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET display_name='Synthetic ordinary edit' WHERE id=auth.uid();
DO $$ BEGIN
 BEGIN UPDATE public.profiles SET line_user_id='U_forged' WHERE id=auth.uid(); RAISE EXCEPTION 'direct LINE identity accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_IDENTITY_REQUIRES_PROVIDER_PROOF' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.profiles(id,line_user_id) VALUES(auth.uid(),'U_forged'); RAISE EXCEPTION 'direct profile insert identity accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LINE_IDENTITY_REQUIRES_PROVIDER_PROOF' THEN RAISE; END IF; END;
 BEGIN UPDATE public.line_user_links SET line_user_id='U_forged' WHERE user_id=auth.uid(); RAISE EXCEPTION 'direct ownership accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_line((SELECT display_name='Synthetic ordinary edit' AND line_user_id IS NULL FROM public.profiles
 WHERE id='c9010000-0000-4000-8000-000000000003'),'normal edit preserved; unverified identity unchanged');

-- A legacy LINE-only prefix must be excluded by the database before pagination,
-- while normal verified LINE and the original email eligibility stay available.
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('c9030000-0000-4000-8000-000000000001','Synthetic LINE reminder','synthetic-line-proof-reminder','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_reminder_settings(facility_id,remind_7d_line,remind_3d_line)
 VALUES('c9030000-0000-4000-8000-000000000001',true,true);
-- The standalone schema-only local shadow has no catalog seed data; a fresh
-- replay already contains this migration-owned option and leaves it unchanged.
INSERT INTO public.option_catalog(key,name,description,monthly_price,is_active)
 VALUES('reminder_line','Synthetic LINE option','Synthetic disposable fixture',0,true) ON CONFLICT(key) DO NOTHING;
INSERT INTO public.facility_entitlements(facility_id,option_key,status)
 VALUES('c9030000-0000-4000-8000-000000000001','reminder_line','active');
UPDATE public.profiles SET line_user_id='U_unverified_prefix' WHERE id='c9010000-0000-4000-8000-000000000003';
INSERT INTO public.line_user_links(user_id,line_user_id) VALUES('c9010000-0000-4000-8000-000000000003','U_unverified_prefix');
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,status,email)
 VALUES('c9020000-0000-4000-8000-000000000001','c9030000-0000-4000-8000-000000000001','c9010000-0000-4000-8000-000000000003','2035-01-08','10:00','11:00','Synthetic legacy prefix','confirmed',NULL),
 ('c9020000-0000-4000-8000-000000000002','c9030000-0000-4000-8000-000000000001','c9010000-0000-4000-8000-000000000001','2035-01-08','12:00','13:00','Synthetic verified LINE','confirmed',NULL),
 ('c9020000-0000-4000-8000-000000000003','c9030000-0000-4000-8000-000000000001','c9010000-0000-4000-8000-000000000005','2035-01-02','14:00','15:00','Synthetic email only','confirmed','synthetic-reminder@example.invalid');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_line((SELECT id='c9020000-0000-4000-8000-000000000002' FROM public.pending_booking_reminders('2035-01-01')
 WHERE booking_date='2035-01-08' ORDER BY id LIMIT 1),'legacy prefix excluded before batch limit');
SELECT pg_temp.assert_line((SELECT count(*)=2 FROM public.pending_booking_reminders('2035-01-01')
 WHERE facility_id='c9030000-0000-4000-8000-000000000001'),'verified LINE and ordinary next-day email eligibility preserved');
RESET ROLE;
SELECT pg_temp.assert_line(NOT has_function_privilege('authenticated','public.pending_booking_reminders(date)','EXECUTE')
 AND has_function_privilege('service_role','public.pending_booking_reminders(date)','EXECUTE'),'reminder ACL preserved');
SELECT 'LINE verified binding/replay/legacy/actor/ACL/rollback fixtures passed';
ROLLBACK;
