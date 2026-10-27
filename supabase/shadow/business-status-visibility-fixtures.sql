\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fe710000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('fe710000-0000-4000-8000-000000000001','visibility-owner@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fe720000-0000-4000-8000-000000000001','Visibility A','visibility-a-synthetic','その他','合成県','合成市','合成住所','draft'),
 ('fe720000-0000-4000-8000-000000000002','Visibility B','visibility-b-synthetic','その他','合成県','合成市','合成住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES ('fe710000-0000-4000-8000-000000000001','fe720000-0000-4000-8000-000000000001','owner');
DO $$ DECLARE actor uuid := 'fe710000-0000-4000-8000-000000000001'; facility uuid := 'fe720000-0000-4000-8000-000000000001'; bad jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fe720000-%' AND show_business_status IS DISTINCT FROM true) THEN RAISE EXCEPTION 'legacy default changed'; END IF;
 PERFORM public.update_facility_settings_atomic(actor,facility,'{"show_business_status":false}');
 IF (SELECT show_business_status FROM public.facility_profiles WHERE id=facility) IS DISTINCT FROM false THEN RAISE EXCEPTION 'hide not saved'; END IF;
 IF (SELECT show_business_status FROM public.facility_profiles WHERE id='fe720000-0000-4000-8000-000000000002') IS DISTINCT FROM true THEN RAISE EXCEPTION 'another facility changed'; END IF;
 PERFORM public.update_facility_settings_atomic(actor,facility,'{"name":"Synthetic renamed"}');
 IF (SELECT show_business_status FROM public.facility_profiles WHERE id=facility) IS DISTINCT FROM false THEN RAISE EXCEPTION 'omitted setting reset'; END IF;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,"false",0,{}]') LOOP
  BEGIN
   PERFORM public.update_facility_settings_atomic(actor,facility,jsonb_build_object('show_business_status',bad));
   RAISE EXCEPTION 'invalid value accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_FACILITY_PATCH' THEN RAISE; END IF;
  END;
 END LOOP;
 PERFORM public.update_facility_settings_atomic(actor,facility,'{"show_business_status":true}');
 IF (SELECT show_business_status FROM public.facility_profiles WHERE id=facility) IS DISTINCT FROM true THEN RAISE EXCEPTION 'enable not saved'; END IF;
 DELETE FROM public.facility_members WHERE facility_id=facility;
 BEGIN
  PERFORM public.update_facility_settings_atomic(actor,facility,'{"show_business_status":false}');
  RAISE EXCEPTION 'revoked role accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FACILITY_PERMISSION_REVOKED' THEN RAISE; END IF;
 END;
 IF has_function_privilege('anon','public.update_facility_settings_atomic(uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.update_facility_settings_atomic(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public write ACL widened'; END IF;
END $$;
ROLLBACK;
