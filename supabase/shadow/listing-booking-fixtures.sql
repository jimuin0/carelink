-- Synthetic, transactional fixtures. Never run against production.
BEGIN;
SET LOCAL statement_timeout = '5s';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
VALUES('72000000-0000-4000-8000-000000000001','Synthetic','synthetic-listing-booking','その他','検証県','検証市','検証番地','published');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
VALUES('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','synthetic','Synthetic',0,30,true),
('72000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000001','synthetic','Synthetic second',0,30,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active)
VALUES('72000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','Synthetic','synthetic',true),
('72000000-0000-4000-8000-000000000006','72000000-0000-4000-8000-000000000001','Inactive','inactive',false);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time)
VALUES('72000000-0000-4000-8000-000000000003',1,'09:00','23:59'),
('72000000-0000-4000-8000-000000000006',1,'09:00','23:59');
DO $$ BEGIN
  IF public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Unconfirmed hours accepted'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_available_slots('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','2030-01-07',30)) THEN RAISE EXCEPTION 'Unprepared slots'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_month_availability('72000000-0000-4000-8000-000000000001',ARRAY['72000000-0000-4000-8000-000000000003'::uuid],2030,1,30) WHERE slots>0) THEN RAISE EXCEPTION 'Unprepared monthly slots'; END IF;
  BEGIN
    PERFORM public.create_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','10:00','10:30','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',true);
    RAISE EXCEPTION 'Unprepared mutation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_NOT_READY%' THEN RAISE; END IF; END;
  -- Admin-owned phone booking remains possible without activating online booking.
  PERFORM public.create_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','10:00','10:30','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',false);
END $$;
INSERT INTO public.facility_photos(id,facility_id,photo_url,photo_type)
VALUES('72000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001','https://example.invalid/synthetic.jpg','other');
UPDATE public.facility_profiles SET business_hours='{"mon":{"open":"22:00","close":"23:59"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
WHERE id='72000000-0000-4000-8000-000000000001';
DO $$ DECLARE new_id uuid; value jsonb;
BEGIN
  IF NOT public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Ready rejected'; END IF;
  FOREACH value IN ARRAY ARRAY['null'::jsonb,'{}'::jsonb,'[]'::jsonb,'{"mon":null}'::jsonb,'{"mon":{"open":"18:00","close":"10:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'::jsonb] LOOP
    IF public.confirmed_booking_hours(value) THEN RAISE EXCEPTION 'Malformed hours accepted'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.get_available_slots('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','2030-01-07',180)) THEN RAISE EXCEPTION 'Midnight wrap accepted'; END IF;
  IF (SELECT count(*) FROM public.get_available_slots('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','2030-01-07',15))<>4 THEN RAISE EXCEPTION 'Late slots incorrect or looping'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_available_slots('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','2030-01-07',0)) THEN RAISE EXCEPTION 'Zero duration accepted'; END IF;
  BEGIN
    PERFORM public.create_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000006',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','22:00','22:30','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',true);
    RAISE EXCEPTION 'Inactive staff accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'STAFF_NOT_WORKING%' THEN RAISE; END IF; END;
  UPDATE public.facility_menus SET is_published=false WHERE id='72000000-0000-4000-8000-000000000005';
  BEGIN
    PERFORM public.create_online_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','22:00','22:30','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',ARRAY['72000000-0000-4000-8000-000000000002'::uuid,'72000000-0000-4000-8000-000000000005'::uuid]);
    RAISE EXCEPTION 'Hidden secondary menu accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_MENU_UNAVAILABLE%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.bookings WHERE facility_id='72000000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'Rejected reservation persisted'; END IF;
  UPDATE public.facility_menus SET is_published=true WHERE id='72000000-0000-4000-8000-000000000005';
  new_id := public.create_online_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','22:00','22:30','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',ARRAY['72000000-0000-4000-8000-000000000002'::uuid,'72000000-0000-4000-8000-000000000005'::uuid]);
  IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=new_id AND cardinality(menu_ids)=2) THEN RAISE EXCEPTION 'Menu selection not atomic'; END IF;
END $$;
CREATE FUNCTION pg_temp.reject_synthetic_menu_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SYNTHETIC_MENU_WRITE_FAILURE'; END $$;
CREATE TRIGGER synthetic_menu_write_failure BEFORE UPDATE OF menu_ids ON public.bookings
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_synthetic_menu_write();
DO $$ BEGIN
  BEGIN
    PERFORM public.create_online_booking_atomic('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003',NULL,'72000000-0000-4000-8000-000000000002',NULL,'2030-01-07','22:30','23:00','Synthetic','synthetic@example.invalid',NULL,NULL,0,0,'pending',ARRAY['72000000-0000-4000-8000-000000000002'::uuid,'72000000-0000-4000-8000-000000000005'::uuid]);
    RAISE EXCEPTION 'Partial menu write accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'SYNTHETIC_MENU_WRITE_FAILURE%' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.bookings WHERE facility_id='72000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'Partial booking not rolled back'; END IF;
END $$;
DROP TRIGGER synthetic_menu_write_failure ON public.bookings;
DO $$ DECLARE role_name text; signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean)',
    'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)',
    'public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,signature,'EXECUTE') THEN RAISE EXCEPTION 'Public mutation permission'; END IF;
    END LOOP;
    IF signature LIKE 'public.create_online_booking_atomic%' THEN
      IF has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Unkeyed public booking bypass'; END IF;
    ELSIF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Service mutation permission missing'; END IF;
  END LOOP;
END $$;
DO $$ DECLARE role_name text; signature text;
BEGIN
  -- Availability reads run only through the rate-limited API routes (service_role).
  FOREACH signature IN ARRAY ARRAY[
    'public.get_available_slots(uuid,uuid,date,integer)',
    'public.get_month_availability(uuid,uuid[],integer,integer,integer)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,signature,'EXECUTE') THEN RAISE EXCEPTION 'Public availability RPC bypasses API rate limits'; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Service availability permission missing'; END IF;
  END LOOP;
END $$;
-- Working time decides online readiness (20261023080000). get_available_slots opens slots
-- only inside a weekly working day or an upcoming working special day, so an active staff
-- member without either cannot be booked and must not make the shop look bookable.
DO $$ DECLARE jst_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF NOT public.staff_has_working_time('72000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Weekly working day ignored'; END IF;
  IF (SELECT active_staff_count FROM public.facility_card_view WHERE id='72000000-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'Card miscounts working staff'; END IF;
  DELETE FROM public.staff_schedules WHERE staff_id='72000000-0000-4000-8000-000000000003';
  IF public.staff_has_working_time('72000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'No working time accepted'; END IF;
  -- The inactive member still has a weekly day; inactive staff never count.
  IF public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Shop without working staff offered for booking'; END IF;
  IF (SELECT active_staff_count FROM public.facility_card_view WHERE id='72000000-0000-4000-8000-000000000001')<>0 THEN RAISE EXCEPTION 'Card advertises staff without working time'; END IF;
  -- A past working special day, a holiday and a special day without times open nothing.
  INSERT INTO public.schedule_overrides(staff_id,date,is_holiday,start_time,end_time) VALUES
    ('72000000-0000-4000-8000-000000000003',jst_today-1,false,'10:00','12:00'),
    ('72000000-0000-4000-8000-000000000003',jst_today+2,true,NULL,NULL),
    ('72000000-0000-4000-8000-000000000003',jst_today+3,NULL,NULL,NULL);
  IF public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Past, holiday or timeless special day accepted'; END IF;
  -- An upcoming working special day is working time, and slots open on it.
  INSERT INTO public.schedule_overrides(staff_id,date,is_holiday,start_time,end_time)
    VALUES('72000000-0000-4000-8000-000000000003','2030-01-14',false,'22:00','23:30');
  IF NOT public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Upcoming special day ignored'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_available_slots('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','2030-01-14',30)) THEN RAISE EXCEPTION 'Ready shop has no special-day slot'; END IF;
END $$;
-- Search cards are read by visitors: the view is security_invoker, so anon must be able to
-- evaluate the working-time rule (function grant, public reads of schedules).
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT active_staff_count FROM public.facility_card_view WHERE id='72000000-0000-4000-8000-000000000001') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Anonymous card cannot see working staff'; END IF;
  IF NOT public.facility_booking_ready('72000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Anonymous readiness differs'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
