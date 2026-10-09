-- Isolated PG17 fixture: precise retirement scope, failure rollback and retained
-- business records. No external Auth endpoint/provider, real user or Storage delete.
BEGIN;
CREATE FUNCTION pg_temp.assert_retirement(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'retirement fixture failed: %',label; END IF; END $$;
SELECT pg_temp.assert_retirement(current_setting('server_version_num')::int BETWEEN 170000 AND 179999,'PG17');
SELECT pg_temp.assert_retirement(NOT has_function_privilege('anon','public.cleanup_deleting_account_personal_data()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.cleanup_deleting_account_personal_data()','EXECUTE')
  AND NOT has_function_privilege('service_role','public.cleanup_deleting_account_personal_data()','EXECUTE'),'trigger-only, no application role callable');
SELECT pg_temp.assert_retirement((SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
  AND tgname IN ('guard_account_deletion_active_bookings','guard_account_deletion_personal_cleanup') AND NOT tgisinternal
  AND (tgtype&11)=11 AND tgenabled IN ('O','A')),'active booking BEFORE cleanup trigger order');
SELECT pg_temp.assert_retirement(public.account_deletion_cleanup_version()=1,'guard version ready');
SELECT pg_temp.assert_retirement(NOT has_function_privilege('anon','public.account_deletion_cleanup_version()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.account_deletion_cleanup_version()','EXECUTE')
  AND has_function_privilege('service_role','public.account_deletion_cleanup_version()','EXECUTE'),'readiness server-only');
DO $$ BEGIN
  -- Managed local postgres has TRIGGER privilege but does not own Auth tables.
  -- The standalone shadow owner can additionally prove a disabled-guard marker.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname='users' AND pg_has_role(current_user,c.relowner,'MEMBER')) THEN
    EXECUTE 'ALTER TABLE auth.users DISABLE TRIGGER guard_account_deletion_personal_cleanup';
    PERFORM pg_temp.assert_retirement(public.account_deletion_cleanup_version()=0,'disabled cleanup fails readiness');
    EXECUTE 'ALTER TABLE auth.users ENABLE TRIGGER guard_account_deletion_personal_cleanup';
  END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('ed010000-0000-4000-8000-000000000001','retirement-owner@example.invalid',now()),
('ed010000-0000-4000-8000-000000000002','retirement-coowner@example.invalid',now()),
('ed010000-0000-4000-8000-000000000003','retirement-otherowner@example.invalid',now()),
('ed010000-0000-4000-8000-000000000004','retirement-spoof-line@example.invalid',now()),
('ed010000-0000-4000-8000-000000000005','retirement-ambiguous-line@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
('ed020000-0000-4000-8000-000000000001','Synthetic retirement','synthetic-retirement','その他','検証県','検証市','検証住所','published'),
('ed020000-0000-4000-8000-000000000002','Synthetic shared retirement','synthetic-shared-retirement','その他','検証県','検証市','検証住所','published');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
('ed010000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000000001','owner'),
('ed010000-0000-4000-8000-000000000002','ed020000-0000-4000-8000-000000000002','owner'),
('ed010000-0000-4000-8000-000000000003','ed020000-0000-4000-8000-000000000002','owner');
UPDATE public.profiles SET line_user_id='Ued000000000000000000000000000001' WHERE id='ed010000-0000-4000-8000-000000000001';
INSERT INTO public.line_user_links(line_user_id,user_id,display_name) VALUES
('Ued000000000000000000000000000001','ed010000-0000-4000-8000-000000000001','Synthetic owned LINE link'),
('Ued000000000000000000000000000003','ed010000-0000-4000-8000-000000000003','Synthetic other account LINE link'),
('Ued000000000000000000000000000004','ed010000-0000-4000-8000-000000000004','Synthetic spoofing account owned link'),
('Ued000000000000000000000000000005',NULL,'Synthetic ambiguous legacy follower');
-- The profile cache can contain somebody else's LINE ID (its owner profile
-- need not also cache it), or a legacy follower with no proven account owner.
-- Neither is authorization to erase that row when this account retires.
UPDATE public.profiles SET line_user_id='Ued000000000000000000000000000003' WHERE id='ed010000-0000-4000-8000-000000000004';
UPDATE public.profiles SET line_user_id='Ued000000000000000000000000000005' WHERE id='ed010000-0000-4000-8000-000000000005';
INSERT INTO public.favorites(user_id,facility_id) VALUES('ed010000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000000001');
INSERT INTO public.user_points(user_id,points,reason) VALUES('ed010000-0000-4000-8000-000000000001',500,'Synthetic account balance');
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,note) VALUES
('ed030000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001',current_date-5,'10:00','11:00','Synthetic retained customer','retirement-owner@example.invalid','completed',1000,'Retained booking content'),
('ed030000-0000-4000-8000-000000000002','ed020000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001',current_date+5,'10:00','11:00','Synthetic guarded customer','retirement-owner@example.invalid','pending',1000,'Retained future content');
INSERT INTO public.treatment_records(id,facility_id,user_id,notes) VALUES('ed040000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','Retained clinical record');
INSERT INTO public.treatment_plans(id,facility_id,user_id,title,notes) VALUES('ed040000-0000-4000-8000-000000000002','ed020000-0000-4000-8000-000000000001','ed010000-0000-4000-8000-000000000001','Synthetic plan','Retained clinical plan');
INSERT INTO public.nps_surveys(id,user_id,facility_id,score,comment) VALUES('ed040000-0000-4000-8000-000000000003','ed010000-0000-4000-8000-000000000001','ed020000-0000-4000-8000-000000000001',8,'Retained survey comment');
INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,created_by) VALUES('ed050000-0000-4000-8000-000000000001','promo','Synthetic campaign','Retained campaign content','ed010000-0000-4000-8000-000000000001');
INSERT INTO public.api_keys(id,facility_id,name,key_hash,key_prefix,created_by) VALUES('ed050000-0000-4000-8000-000000000002','ed020000-0000-4000-8000-000000000001','Synthetic key',repeat('a',64),'synthetic-key','ed010000-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.fail_retirement_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.user_id='ed010000-0000-4000-8000-000000000001' AND current_setting('carelink.retirement_fixture_cleanup_fail',true)='yes'
    THEN RAISE EXCEPTION 'SYNTHETIC_RETIREMENT_CLEANUP_FAILURE'; END IF; RETURN OLD; END $$;
CREATE TRIGGER synthetic_retirement_cleanup_failure BEFORE DELETE ON public.favorites FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_retirement_cleanup();
CREATE FUNCTION pg_temp.fail_retirement_after_auth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.id='ed010000-0000-4000-8000-000000000001' AND current_setting('carelink.retirement_fixture_auth_fail',true)='yes'
    THEN RAISE EXCEPTION 'SYNTHETIC_AUTH_DELETE_FAILURE'; END IF; RETURN NULL; END $$;
CREATE TRIGGER zzz_synthetic_retirement_auth_failure AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_retirement_after_auth();
SELECT set_config('carelink.retirement_fixture_cleanup_fail','yes',true);
-- The real local Auth role owns auth.users. Shadow builders may not define the
-- provider role; retain the same trigger test without adding any Auth grants.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DO $$ BEGIN
  BEGIN DELETE FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'active retirement accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ACCOUNT_ACTIVE_BOOKINGS_PREVENT_DELETION' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_retirement(EXISTS(SELECT 1 FROM public.favorites WHERE user_id='ed010000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='Ued000000000000000000000000000001'),'booking guard fires before any cleanup');
UPDATE public.bookings SET status='cancelled' WHERE id='ed030000-0000-4000-8000-000000000002';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DO $$ BEGIN
  BEGIN DELETE FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'failed cleanup accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_RETIREMENT_CLEANUP_FAILURE' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_retirement(EXISTS(SELECT 1 FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='Ued000000000000000000000000000001')
  AND EXISTS(SELECT 1 FROM public.favorites WHERE user_id='ed010000-0000-4000-8000-000000000001'),'cleanup error rolls back even earlier LINE deletion');
SELECT set_config('carelink.retirement_fixture_cleanup_fail','no',true);
SELECT set_config('carelink.retirement_fixture_auth_fail','yes',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DO $$ BEGIN
  BEGIN DELETE FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'failed Auth deletion accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_AUTH_DELETE_FAILURE' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_retirement(EXISTS(SELECT 1 FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.profiles WHERE id='ed010000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.favorites WHERE user_id='ed010000-0000-4000-8000-000000000001')
  AND (SELECT count(*)=2 FROM public.user_points WHERE user_id='ed010000-0000-4000-8000-000000000001')
  AND (SELECT status='published' FROM public.facility_profiles WHERE id='ed020000-0000-4000-8000-000000000001'),'late Auth failure rolls back preferences, typed points, profile, owner and suspension');
SELECT pg_temp.assert_retirement((SELECT user_id='ed010000-0000-4000-8000-000000000001' FROM public.treatment_records WHERE id='ed040000-0000-4000-8000-000000000001')
  AND (SELECT created_by='ed010000-0000-4000-8000-000000000001' FROM public.newsletter_campaigns WHERE id='ed050000-0000-4000-8000-000000000001'),'late Auth failure rolls back business reference detachment');
SELECT set_config('carelink.retirement_fixture_auth_fail','no',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DELETE FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_retirement(NOT EXISTS(SELECT 1 FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='ed010000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.favorites WHERE user_id='ed010000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id='ed010000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='Ued000000000000000000000000000001'),'successful Auth deletion and personal cleanup commit together');
SELECT pg_temp.assert_retirement((SELECT status='suspended' FROM public.facility_profiles WHERE id='ed020000-0000-4000-8000-000000000001'),'last owner suspension committed without physical facility deletion');
SELECT pg_temp.assert_retirement((SELECT user_id IS NULL AND note='Retained booking content' AND email='retirement-owner@example.invalid' FROM public.bookings WHERE id='ed030000-0000-4000-8000-000000000001')
  AND (SELECT user_id IS NULL AND notes='Retained clinical record' FROM public.treatment_records WHERE id='ed040000-0000-4000-8000-000000000001')
  AND (SELECT user_id IS NULL AND notes='Retained clinical plan' FROM public.treatment_plans WHERE id='ed040000-0000-4000-8000-000000000002')
  AND (SELECT user_id IS NULL AND comment='Retained survey comment' FROM public.nps_surveys WHERE id='ed040000-0000-4000-8000-000000000003'),'business content/contact retained; reference detachment is not anonymization');
SELECT pg_temp.assert_retirement((SELECT created_by IS NULL AND html_content='Retained campaign content' FROM public.newsletter_campaigns WHERE id='ed050000-0000-4000-8000-000000000001')
  AND (SELECT created_by IS NULL AND name='Synthetic key' FROM public.api_keys WHERE id='ed050000-0000-4000-8000-000000000002'),'creator references detach without deleting retained records');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DELETE FROM auth.users WHERE id='ed010000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT pg_temp.assert_retirement((SELECT status='published' FROM public.facility_profiles WHERE id='ed020000-0000-4000-8000-000000000002')
  AND EXISTS(SELECT 1 FROM public.facility_members WHERE facility_id='ed020000-0000-4000-8000-000000000002' AND role='owner'),'other owner keeps facility publication and management');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DELETE FROM auth.users WHERE id IN ('ed010000-0000-4000-8000-000000000004','ed010000-0000-4000-8000-000000000005');
RESET ROLE;
SELECT pg_temp.assert_retirement(NOT EXISTS(SELECT 1 FROM public.line_user_links WHERE user_id='ed010000-0000-4000-8000-000000000004')
  AND EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='Ued000000000000000000000000000003' AND user_id='ed010000-0000-4000-8000-000000000003')
  AND EXISTS(SELECT 1 FROM public.line_user_links WHERE line_user_id='Ued000000000000000000000000000005' AND user_id IS NULL),
  'retirement deletes own link despite mismatched profile cache, preserves other account and ambiguous legacy links');
SELECT 'account retirement transaction/rollback/scope/owner checks passed';
ROLLBACK;
