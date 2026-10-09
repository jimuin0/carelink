-- Execute only against the isolated migrated PG17 fixture DB. Every fixture and
-- injected failure rolls back. This is a transaction test, not a production probe.
BEGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PG17_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND datname IN ('postgres','carelink_shadow','carelink_staff_probe')) THEN RAISE EXCEPTION 'FIXTURE_DATABASE_REQUIRED'; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('dc010000-0000-4000-8000-000000000001','staff-owner@example.invalid',now()),
('dc010000-0000-4000-8000-000000000002','staff-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
('dc020000-0000-4000-8000-000000000001','Synthetic staff atomic','synthetic-staff-atomic','その他','検証県','検証市','検証住所','draft'),
('dc020000-0000-4000-8000-000000000002','Synthetic other tenant','synthetic-staff-other','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
('dc010000-0000-4000-8000-000000000001','dc020000-0000-4000-8000-000000000001','owner'),
('dc010000-0000-4000-8000-000000000002','dc020000-0000-4000-8000-000000000002','owner');
CREATE FUNCTION pg_temp.fail_staff_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=NEW.staff_id AND slug='staff-dc050000-0000-4000-8000-000000000099')
    OR NEW.start_time='13:37'::time THEN RAISE EXCEPTION 'INJECTED_SCHEDULE_FAILURE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER fixture_staff_insert_failure BEFORE INSERT ON public.staff_schedules FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_staff_schedule();
SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid:='dc010000-0000-4000-8000-000000000001'; f uuid:='dc020000-0000-4000-8000-000000000001';
  other uuid:='dc010000-0000-4000-8000-000000000002'; f2 uuid:='dc020000-0000-4000-8000-000000000002';
  op uuid:='dc050000-0000-4000-8000-000000000001'; staff uuid; r jsonb; old_rows jsonb; original_count int;
  monday date:=(now() AT TIME ZONE 'Asia/Tokyo')::date+14; n int;
BEGIN
  FOREACH r IN ARRAY ARRAY['{"name":"  Test staff  "}'::jsonb] LOOP
    r:=public.create_staff_with_schedules_atomic(a,f,op,r);
    staff:=(r->'staff'->>'id')::uuid;
    IF r->>'replayed'<>'false' OR r->'staff'->>'name'<>'Test staff' THEN RAISE EXCEPTION 'CREATE_RESULT'; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.staff_schedules WHERE staff_id=staff AND start_time='09:00' AND end_time='19:00';
  IF n<>7 THEN RAISE EXCEPTION 'SEVEN_DEFAULT_DAYS_REQUIRED'; END IF;
  r:=public.create_staff_with_schedules_atomic(a,f,op,'{"name":"  Test staff  "}');
  IF r->>'replayed'<>'true' OR (r->'staff'->>'id')::uuid<>staff THEN RAISE EXCEPTION 'CREATE_REPLAY'; END IF;
  IF (SELECT count(*) FROM public.staff_profiles WHERE facility_id=f)<>1 THEN RAISE EXCEPTION 'DUPLICATE_CREATE'; END IF;
  BEGIN PERFORM public.create_staff_with_schedules_atomic(a,f,op,'{"name":"different"}'); RAISE EXCEPTION 'EXPECTED_CONFLICT';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STAFF_OPERATION_CONFLICT' THEN RAISE; END IF; END;
  BEGIN PERFORM public.create_staff_with_schedules_atomic(other,f,'dc050000-0000-4000-8000-000000000002','{"name":"Unauthorized"}'); RAISE EXCEPTION 'EXPECTED_DENIED';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.create_staff_with_schedules_atomic(a,f,'dc050000-0000-4000-8000-000000000099','{"name":"Seed must rollback"}'); RAISE EXCEPTION 'EXPECTED_SEED_FAILURE';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INJECTED_SCHEDULE_FAILURE' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE slug='staff-dc050000-0000-4000-8000-000000000099')
    OR EXISTS (SELECT 1 FROM public.staff_mutation_operations WHERE operation_id='dc050000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'PARTIAL_STAFF_CREATION'; END IF;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY day_of_week) INTO old_rows FROM public.staff_schedules s WHERE staff_id=staff;
  BEGIN PERFORM public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000003','[{"day_of_week":1,"start_time":"13:37","end_time":"18:00"}]',false); RAISE EXCEPTION 'EXPECTED_REPLACE_FAILURE';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INJECTED_SCHEDULE_FAILURE' THEN RAISE; END IF; END;
  IF old_rows IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY day_of_week) FROM public.staff_schedules s WHERE staff_id=staff)
    OR EXISTS (SELECT 1 FROM public.staff_mutation_operations WHERE operation_id='dc050000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'PARTIAL_SCHEDULE_REPLACE'; END IF;
  BEGIN PERFORM public.replace_staff_schedules_atomic(other,f2,staff,'dc050000-0000-4000-8000-000000000004','[]',true); RAISE EXCEPTION 'EXPECTED_TENANT_REJECTION';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STAFF_NOT_FOUND' THEN RAISE; END IF; END;
  BEGIN PERFORM public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000005','[{"day_of_week":1,"start_time":"09:00","end_time":"18:00"},{"day_of_week":1,"start_time":"10:00","end_time":"19:00"}]',true); RAISE EXCEPTION 'EXPECTED_VALIDATION';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STAFF_INPUT_INVALID' THEN RAISE; END IF; END;
  INSERT INTO public.bookings(id,facility_id,staff_id,booking_date,start_time,end_time,customer_name,email,status,total_price)
    VALUES('dc060000-0000-4000-8000-000000000001',f,staff,monday,'10:00','11:00','Synthetic fixture','staff-booking@example.invalid','confirmed',1000);
  r:=public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000006','[]',false);
  IF r->>'code'<>'BOOKINGS_AFFECTED' OR (r->>'affectedBookings')::int<>1 THEN RAISE EXCEPTION 'BOOKING_IMPACT_GUARD'; END IF;
  IF (SELECT count(*) FROM public.staff_schedules WHERE staff_id=staff)<>7 THEN RAISE EXCEPTION 'GUARD_MUST_NOT_WRITE'; END IF;
  PERFORM public.save_staff_override_atomic(a,f,staff,monday,false,'09:00','18:00',false);
  r:=public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000007','[]',false);
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'OVERRIDE_DATE_EXCLUSION'; END IF;
  -- A delayed retry of an old success may not overwrite a newer edit.
  PERFORM public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000008','[{"day_of_week":1,"start_time":"09:00","end_time":"18:00"}]',true);
  r:=public.replace_staff_schedules_atomic(a,f,staff,'dc050000-0000-4000-8000-000000000007','[]',false);
  IF r->>'replayed'<>'true' OR (SELECT count(*) FROM public.staff_schedules WHERE staff_id=staff)<>1 THEN RAISE EXCEPTION 'STALE_REPLAY_OVERWROTE_NEW_EDIT'; END IF;
  r:=public.save_staff_override_atomic(a,f,staff,monday,true,NULL,NULL,false);
  IF r->>'code'<>'BOOKINGS_AFFECTED' THEN RAISE EXCEPTION 'OVERRIDE_IMPACT_GUARD'; END IF;
  PERFORM public.save_staff_override_atomic(a,f,staff,monday,true,NULL,NULL,true);
  IF NOT EXISTS(SELECT 1 FROM public.schedule_overrides WHERE staff_id=staff AND date=monday AND is_holiday AND start_time IS NULL AND end_time IS NULL) THEN RAISE EXCEPTION 'HOLIDAY_CLEARS_STALE_TIMES'; END IF;
  IF public.delete_staff_override_atomic(a,f,staff,'dc070000-0000-4000-8000-000000000099') THEN RAISE EXCEPTION 'PHANTOM_DELETE'; END IF;
  r:=public.get_staff_mutation_operation(a,f,op,'create',NULL);
  IF r->>'state'<>'saved' OR (r->>'staff_id')::uuid<>staff THEN RAISE EXCEPTION 'RECOVERY_TARGET'; END IF;
  BEGIN PERFORM public.get_staff_mutation_operation(other,f2,op,'create',NULL); RAISE EXCEPTION 'EXPECTED_PRIVATE_OPERATION';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM public.staff_profiles WHERE id=staff;
  r:=public.get_staff_mutation_operation(a,f,op,'create',NULL);
  IF r->>'state'<>'retired' THEN RAISE EXCEPTION 'RETIRED_RECEIPT_MISSING'; END IF;
  BEGIN PERFORM public.create_staff_with_schedules_atomic(a,f,op,'{"name":"  Test staff  "}'); RAISE EXCEPTION 'EXPECTED_RETIRED_CREATE';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STAFF_OPERATION_RETIRED' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE id=staff) THEN RAISE EXCEPTION 'REPLAY_RESURRECTED_RETIRED_STAFF'; END IF;
  DELETE FROM public.facility_members WHERE user_id=a AND facility_id=f;
  BEGIN PERFORM public.create_staff_with_schedules_atomic(a,f,op,'{"name":"  Test staff  "}'); RAISE EXCEPTION 'EXPECTED_REVOKED_REPLAY';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE sig text; BEGIN
  FOREACH sig IN ARRAY ARRAY['public.create_staff_with_schedules_atomic(uuid,uuid,uuid,jsonb)','public.replace_staff_schedules_atomic(uuid,uuid,uuid,uuid,jsonb,boolean)',
    'public.save_staff_override_atomic(uuid,uuid,uuid,date,boolean,time,time,boolean)','public.delete_staff_override_atomic(uuid,uuid,uuid,uuid)',
    'public.get_staff_mutation_operation(uuid,uuid,uuid,text,uuid)'] LOOP
    IF has_function_privilege('anon',sig,'EXECUTE') OR has_function_privilege('authenticated',sig,'EXECUTE')
      OR NOT has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'RPC_PRIVILEGE_REGRESSION: %',sig; END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid=sig::regprocedure) THEN RAISE EXCEPTION 'RPC_MUST_BE_INVOKER'; END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_mutation_operations'::regclass)
    OR has_table_privilege('anon','public.staff_mutation_operations','SELECT') OR has_table_privilege('authenticated','public.staff_mutation_operations','INSERT') THEN RAISE EXCEPTION 'RECEIPT_PRIVILEGE_REGRESSION'; END IF;
END $$;
SELECT 'staff schedule rollback/replay/tenant/permissions/booking-force/recovery checks passed';
ROLLBACK;
