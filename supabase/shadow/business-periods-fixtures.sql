-- Disposable PG17 only. No real facility, provider, mail or customer data.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fe600000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_min(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'business periods: %',label; END IF; END $$;
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('fe600000-0000-4000-8000-000000000001', 'min-overlap-owner@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('fe610000-0000-4000-8000-000000000001', 'Min overlap clinic', 'min-overlap-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role)
 VALUES ('fe600000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'owner');
-- Bookable: 60 minutes and unset (= 60, as the booking page reads it). A 15-minute draft does not count.
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('fe620000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Sixty', 3000, 60, true),
 ('fe620000-0000-4000-8000-000000000002', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Unset', 3000, NULL, NULL),
 ('fe620000-0000-4000-8000-000000000003', 'fe610000-0000-4000-8000-000000000001', 'synthetic', 'Draft', 3000, 15, false);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('fe630000-0000-4000-8000-000000000001', 'fe610000-0000-4000-8000-000000000001', 'Staff A', 'min-overlap-a', true, 1);
-- A works Mondays 07:00-10:30: only 30 minutes inside the 10:00-18:00 hours.
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time) VALUES
 ('fe630000-0000-4000-8000-000000000001', 1, '07:00', '10:30');
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('fe610000-0000-4000-8000-000000000001', 'https://example.invalid/min-overlap.jpg', 'other');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"10:00","close":"18:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id = 'fe610000-0000-4000-8000-000000000001';

UPDATE public.staff_schedules SET start_time='00:00',end_time='24:00' WHERE staff_id='fe630000-0000-4000-8000-000000000001';
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) VALUES
 ('fe630000-0000-4000-8000-000000000001',2,'00:00','24:00');
DO $$ DECLARE hours jsonb; v_slot record; total integer; booking_id uuid; BEGIN
  FOR hours IN SELECT value FROM jsonb_array_elements('[{"open":"09:00","close":"20:00"},{"open":"18:00","close":"05:00"},{"open":"05:00","close":"12:00"},{"open":"00:00","close":"24:00"},{"open":"09:00","close":"12:30","periods":[{"open":"09:00","close":"12:30"},{"open":"15:00","close":"18:20"}]}]') LOOP
    hours:=jsonb_build_object('mon',hours,'tue',null,'wed',null,'thu',null,'fri',null,'sat',null,'sun',null);
    PERFORM pg_temp.assert_min(public.confirmed_booking_hours(hours),'A/B/C/all-day/split valid');
    UPDATE public.facility_profiles SET business_hours=hours WHERE id='fe610000-0000-4000-8000-000000000001';
    SELECT count(*) INTO total FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001','2030-01-07',60);
    PERFORM pg_temp.assert_min(total>0,'actual slots exist');
    FOR v_slot IN SELECT * FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001','2030-01-07',60) LOOP
      PERFORM pg_temp.assert_min(public.business_interval_fits(hours,1,v_slot.slot_start,v_slot.slot_end),'no slot spans lunch or closing');
    END LOOP;
    IF hours->'mon'->>'close'='05:00' THEN
      PERFORM pg_temp.assert_min(EXISTS(SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001','2030-01-08',60) s WHERE s.slot_start='00:00' AND s.slot_end='01:00'),'previous opening day continues');
    END IF;
    IF hours->'mon'->>'close'='24:00' THEN
      PERFORM pg_temp.assert_min(EXISTS(SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001','2030-01-07',60) s WHERE s.slot_start='23:00' AND s.slot_end='24:00'),'last slot ends at 24:00');
    END IF;
  END LOOP;
  PERFORM pg_temp.assert_min(NOT public.business_interval_fits(hours,1,'12:00','15:30'),'a booking cannot span lunch');
  BEGIN
    PERFORM public.create_booking_for_menus_atomic('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001',NULL,
      'fe620000-0000-4000-8000-000000000001',NULL,'2030-01-07','12:00','13:00','Synthetic','hours@example.invalid',NULL,NULL,3000,0,'confirmed',true,ARRAY['fe620000-0000-4000-8000-000000000001'::uuid]);
    RAISE EXCEPTION 'lunch booking unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'BOOKING_OUTSIDE_HOURS:%' THEN RAISE; END IF; END;
  booking_id:=public.create_booking_for_menus_atomic('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001',NULL,
    'fe620000-0000-4000-8000-000000000001',NULL,'2030-01-07','15:00','16:00','Synthetic','hours@example.invalid',NULL,NULL,3000,0,'confirmed',true,ARRAY['fe620000-0000-4000-8000-000000000001'::uuid]);
  BEGIN
    PERFORM public.change_booking_atomic(booking_id,NULL,'2030-01-07','12:00','13:00',true);
    RAISE EXCEPTION 'lunch change unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'BOOKING_OUTSIDE_HOURS:%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_min((SELECT start_time='15:00' FROM public.bookings WHERE id=booking_id),'rejected change preserves original booking');
  UPDATE public.facility_profiles SET business_hours=jsonb_build_object('mon',jsonb_build_object('open','18:00','close','05:00'),'tue',null,'wed',null,'thu',null,'fri',null,'sat',null,'sun',null),booking_buffer_minutes=15
    WHERE id='fe610000-0000-4000-8000-000000000001';
  PERFORM public.create_booking_for_menus_atomic('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001',NULL,
    'fe620000-0000-4000-8000-000000000001',NULL,'2030-01-07','23:00','24:00','Synthetic','hours@example.invalid',NULL,NULL,3000,0,'confirmed',true,ARRAY['fe620000-0000-4000-8000-000000000001'::uuid]);
  PERFORM pg_temp.assert_min(NOT EXISTS(SELECT 1 FROM public.get_available_slots('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001','2030-01-08',60) s WHERE s.slot_start='00:00'),'previous calendar date buffer removes midnight slot');
  BEGIN
    PERFORM public.create_booking_for_menus_atomic('fe610000-0000-4000-8000-000000000001','fe630000-0000-4000-8000-000000000001',NULL,
      'fe620000-0000-4000-8000-000000000001',NULL,'2030-01-08','00:00','01:00','Synthetic','hours@example.invalid',NULL,NULL,3000,0,'confirmed',true,ARRAY['fe620000-0000-4000-8000-000000000001'::uuid]);
    RAISE EXCEPTION 'adjacent-date buffer conflict unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'BOOKING_CONFLICT:%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_min(NOT public.confirmed_booking_hours(hours || '{"tue":{"open":"00:00","close":"00:00"}}'),'equal times invalid');
END $$;
ROLLBACK;
