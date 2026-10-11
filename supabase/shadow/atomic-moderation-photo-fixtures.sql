-- Disposable replay/local database only. Synthetic data; all writes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' AND NOT (current_database()='postgres'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin'))
    THEN RAISE EXCEPTION 'isolated Supabase/PG17 shadow required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'f8500000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'f8510000-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- Shadow bootstrap deliberately uses auth.uid()=NULL. Only this disposable
-- fixture transaction replaces that stub with its synthetic JWT claims;
-- ROLLBACK restores the bootstrap body. The local real Auth function is kept.
DO $$ BEGIN
  IF current_database() LIKE 'carelink_shadow%' THEN
    EXECUTE $uid$
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $claims$
        SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',
          nullif(current_setting('request.jwt.claim.sub',true),''))::uuid
      $claims$
    $uid$;
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_modphoto(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'moderation/photo fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('f8500000-0000-4000-8000-000000000001','modphoto-owner@example.invalid',now()),
 ('f8500000-0000-4000-8000-000000000002','modphoto-other@example.invalid',now()),
 ('f8500000-0000-4000-8000-000000000003','modphoto-admin@example.invalid',now());
UPDATE public.profiles SET role='admin' WHERE id='f8500000-0000-4000-8000-000000000002';
UPDATE public.profiles SET is_platform_admin=true WHERE id='f8500000-0000-4000-8000-000000000003';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours) VALUES
 ('f8510000-0000-4000-8000-000000000001','Synthetic photo A','modphoto-a','その他','検証県','検証市','検証住所','published','{"mon":{"open":"09:00","close":"18:00"},"tue":{"open":"09:00","close":"18:00"},"wed":{"open":"09:00","close":"18:00"},"thu":{"open":"09:00","close":"18:00"},"fri":{"open":"09:00","close":"18:00"},"sat":null,"sun":null}'),
 ('f8510000-0000-4000-8000-000000000002','Synthetic photo B','modphoto-b','その他','検証県','検証市','検証住所','draft',NULL),
 ('f8510000-0000-4000-8000-000000000003','Synthetic cascade','modphoto-c','その他','検証県','検証市','検証住所','draft',NULL);
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_photos(id,facility_id,photo_url,photo_type) VALUES
 ('f8520000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','https://example.invalid/a1.png','main'),
 ('f8520000-0000-4000-8000-000000000002','f8510000-0000-4000-8000-000000000001','https://example.invalid/a2.png','interior'),
 ('f8520000-0000-4000-8000-000000000003','f8510000-0000-4000-8000-000000000002','https://example.invalid/b.png','main'),
 ('f8520000-0000-4000-8000-000000000004','f8510000-0000-4000-8000-000000000003','https://example.invalid/c.png','main');
INSERT INTO public.facility_menus(facility_id,category,name,price,duration_minutes) VALUES
 ('f8510000-0000-4000-8000-000000000001','synthetic','synthetic menu',1000,60);
INSERT INTO public.staff_profiles(facility_id,name,slug,is_active) VALUES ('f8510000-0000-4000-8000-000000000001','Synthetic staff','modphoto-staff',true);
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,comment,reviewer_ip) VALUES
 ('f8530000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','Synthetic reviewer',4,'fixture','127.0.0.1'),
 ('f8530000-0000-4000-8000-000000000002','f8510000-0000-4000-8000-000000000001','Synthetic rollback',4,'fixture','127.0.0.1'),
 ('f8530000-0000-4000-8000-000000000003','f8510000-0000-4000-8000-000000000002','Synthetic other',4,'fixture','127.0.0.1');
INSERT INTO public.moderation_queue(id,content_type,content_id,facility_id) VALUES
 ('f8540000-0000-4000-8000-000000000001','review','f8530000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001'),
 ('f8540000-0000-4000-8000-000000000002','review','f8530000-0000-4000-8000-000000000002','f8510000-0000-4000-8000-000000000001'),
 ('f8540000-0000-4000-8000-000000000003','review','f8530000-0000-4000-8000-000000000003','f8510000-0000-4000-8000-000000000001'),
 ('f8540000-0000-4000-8000-000000000004','photo','f8520000-0000-4000-8000-000000000003',NULL);
SELECT pg_temp.assert_modphoto(public.facility_booking_ready('f8510000-0000-4000-8000-000000000001'),'initial booking readiness');
DO $$ DECLARE sig text; role_name text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.moderate_content_atomic(uuid,uuid,text,text,text,timestamptz)','public.set_facility_main_photo_atomic(uuid,uuid,uuid)','public.delete_facility_photo_atomic(uuid,uuid,uuid)'] LOOP
  PERFORM pg_temp.assert_modphoto(has_function_privilege('service_role',sig,'EXECUTE'),'service RPC privilege '||sig);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.assert_modphoto(NOT has_function_privilege(role_name,sig,'EXECUTE'),'RPC not public '||role_name||sig);
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_modphoto(NOT has_function_privilege('service_role','public.clear_removed_facility_main_photo()','EXECUTE'),'trigger cannot be directly invoked');
 PERFORM pg_temp.assert_modphoto(NOT has_table_privilege('authenticated','public.facility_photos','DELETE'),'legacy DELETE permission removed');
 PERFORM pg_temp.assert_modphoto(has_table_privilege('authenticated','public.facility_photos','INSERT,UPDATE,SELECT'),'other photo permissions retained');
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f8500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_modphoto((SELECT count(*)=4 FROM public.moderation_queue WHERE id::text LIKE 'f8540000-%'),'platform flag admin may read queue');
DO $$ BEGIN
 BEGIN UPDATE public.moderation_queue SET status='rejected' WHERE id='f8540000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'platform direct queue update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.moderation_queue; RAISE EXCEPTION 'platform direct truncate accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"f8500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_modphoto((SELECT count(*)=0 FROM public.moderation_queue),'legacy role admin without flag has no queue read access');
DO $$ BEGIN
 BEGIN UPDATE public.moderation_queue SET status='rejected' WHERE id='f8540000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'legacy direct queue update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM pg_temp.assert_modphoto((SELECT count(*)=1 FROM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000001','pending','rejected','Synthetic rejection')),'rejected decision commits');
 PERFORM pg_temp.assert_modphoto((SELECT status='rejected' AND reviewed_by='f8500000-0000-4000-8000-000000000003' AND reviewed_at IS NOT NULL FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000001'),'decision/admin recorded');
 PERFORM pg_temp.assert_modphoto((SELECT status='hidden' AND is_flagged AND flag_reason='Synthetic rejection' FROM public.facility_reviews WHERE id='f8530000-0000-4000-8000-000000000001'),'same commit hides review');
 PERFORM pg_temp.assert_modphoto((SELECT replayed FROM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000001','pending','rejected','Synthetic rejection')),'exact response-loss replay');
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000001','pending','approved',NULL);
  RAISE EXCEPTION 'conflicting stale decision accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'MODERATION_REVISION_CONFLICT' THEN RAISE; END IF; END;
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000001','f8540000-0000-4000-8000-000000000002','pending','rejected',NULL);
  RAISE EXCEPTION 'non-platform actor accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'MODERATION_PERMISSION_REVOKED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000003','pending','rejected',NULL);
  RAISE EXCEPTION 'cross-facility content accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'MODERATION_REVIEW_UNAVAILABLE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_modphoto((SELECT status='published' FROM public.facility_reviews WHERE id='f8530000-0000-4000-8000-000000000003'),'scope mismatch leaves other review intact');
 PERFORM pg_temp.assert_modphoto((SELECT count(*)=0 FROM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000099','pending','approved',NULL)),'missing queue not success');
 PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000004','pending','escalated',NULL);
 PERFORM pg_temp.assert_modphoto((SELECT status='escalated' FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000004'),'non-review decision remains supported');
END $$;
RESET ROLE;
UPDATE public.profiles SET is_platform_admin=true WHERE id='f8500000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $$ DECLARE rev timestamptz; BEGIN
 SELECT reviewed_at INTO rev FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000001';
 PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000002','f8540000-0000-4000-8000-000000000001','rejected','approved',NULL,rev);
 SELECT reviewed_at INTO rev FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000001';
 PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000002','f8540000-0000-4000-8000-000000000001','approved','rejected','Synthetic rejection',rev);
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000001','pending','rejected','Synthetic rejection',NULL);
  RAISE EXCEPTION 'old actor ABA retry accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'MODERATION_REVISION_CONFLICT' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_modphoto((SELECT reviewed_by='f8500000-0000-4000-8000-000000000002' FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000001'),'ABA retry preserves newer reviewer');
END $$;
RESET ROLE;
UPDATE public.profiles SET is_platform_admin=false WHERE id='f8500000-0000-4000-8000-000000000002';
CREATE FUNCTION pg_temp.reject_synthetic_hide() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='f8530000-0000-4000-8000-000000000002' AND NEW.status='hidden' THEN RAISE EXCEPTION 'SYNTHETIC_HIDE_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_hide_failure BEFORE UPDATE ON public.facility_reviews FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_synthetic_hide();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000002','pending','rejected',NULL);
  RAISE EXCEPTION 'hide failure accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SYNTHETIC_HIDE_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_modphoto((SELECT status='pending' FROM public.moderation_queue WHERE id='f8540000-0000-4000-8000-000000000002'),'hide failure leaves decision pending');
 PERFORM pg_temp.assert_modphoto((SELECT status='published' FROM public.facility_reviews WHERE id='f8530000-0000-4000-8000-000000000002'),'hide failure leaves original review');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_hide_failure ON public.facility_reviews;
CREATE FUNCTION pg_temp.reject_synthetic_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='f8540000-0000-4000-8000-000000000002' AND NEW.status='rejected' THEN RAISE EXCEPTION 'SYNTHETIC_DECISION_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_decision_failure BEFORE UPDATE ON public.moderation_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_synthetic_decision();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.moderate_content_atomic('f8500000-0000-4000-8000-000000000003','f8540000-0000-4000-8000-000000000002','pending','rejected',NULL);
  RAISE EXCEPTION 'decision failure accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SYNTHETIC_DECISION_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_modphoto((SELECT status='published' AND NOT is_flagged FROM public.facility_reviews WHERE id='f8530000-0000-4000-8000-000000000002'),'decision save failure rolls hide back');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_decision_failure ON public.moderation_queue;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_modphoto((SELECT main_photo_url='https://example.invalid/a1.png' FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'main comes from current owned metadata');
 PERFORM pg_temp.assert_modphoto((SELECT count(*)=0 FROM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000003')),'cross-tenant main not selected');
 PERFORM pg_temp.assert_modphoto((SELECT count(*)=0 FROM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000003')),'cross-tenant delete changes no rows');
 BEGIN PERFORM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000002','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'non-member photo delete accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_PERMISSION_REVOKED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.update_facility_settings_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','{"main_photo_url":"https://example.invalid/stale.png"}');
  RAISE EXCEPTION 'generic settings bypass accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVALID_FACILITY_PATCH' THEN RAISE; END IF; END;
 PERFORM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000002');
 PERFORM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_modphoto((SELECT main_photo_url='https://example.invalid/a2.png' FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'different newly selected main preserved');
END $$;
RESET ROLE;
INSERT INTO public.facility_photos(id,facility_id,photo_url,photo_type) VALUES
 ('f8520000-0000-4000-8000-000000000005','f8510000-0000-4000-8000-000000000001','https://example.invalid/a2.png','main');
SET LOCAL ROLE service_role;
SELECT * FROM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000005');
SELECT * FROM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000005');
SELECT pg_temp.assert_modphoto((SELECT main_photo_url='https://example.invalid/a2.png' FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'remaining duplicate URL retains valid main reference');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_synthetic_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='f8510000-0000-4000-8000-000000000001' AND OLD.main_photo_url IS NOT NULL AND NEW.main_photo_url IS NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_CLEAR_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_clear_failure BEFORE UPDATE ON public.facility_profiles FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_synthetic_clear();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'clear failure accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SYNTHETIC_CLEAR_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_modphoto(EXISTS(SELECT 1 FROM public.facility_photos WHERE id='f8520000-0000-4000-8000-000000000002'),'clear failure rolls metadata deletion back');
 PERFORM pg_temp.assert_modphoto((SELECT main_photo_url='https://example.invalid/a2.png' FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'clear failure preserves main URL');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_clear_failure ON public.facility_profiles;
SELECT set_config('request.jwt.claims','{"sub":"f8500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN DELETE FROM public.facility_photos WHERE id='f8520000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'legacy direct delete still accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.facility_photos SET photo_url='https://example.invalid/a2-replaced.png' WHERE id='f8520000-0000-4000-8000-000000000002';
END $$;
RESET ROLE;
SELECT pg_temp.assert_modphoto((SELECT main_photo_url IS NULL FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'authorized browser URL edit clears old main through narrow trigger');
SET LOCAL ROLE service_role;
SELECT * FROM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000002');
SELECT * FROM public.delete_facility_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_modphoto((SELECT main_photo_url IS NULL AND status='published' FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000001'),'last-photo removal clears URL and preserves listing status');
SELECT pg_temp.assert_modphoto(NOT public.facility_booking_ready('f8510000-0000-4000-8000-000000000001'),'last-photo removal disables online readiness');
SELECT pg_temp.assert_modphoto((SELECT count(*)=0 FROM public.set_facility_main_photo_atomic('f8500000-0000-4000-8000-000000000001','f8510000-0000-4000-8000-000000000001','f8520000-0000-4000-8000-000000000002')),'deleted photo cannot become main from stale selection');
RESET ROLE;
UPDATE public.facility_profiles SET main_photo_url='https://example.invalid/c.png' WHERE id='f8510000-0000-4000-8000-000000000003';
DELETE FROM public.facility_profiles WHERE id='f8510000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_modphoto(NOT EXISTS(SELECT 1 FROM public.facility_photos WHERE id='f8520000-0000-4000-8000-000000000004'),'parent cascade remains valid');
ROLLBACK;
