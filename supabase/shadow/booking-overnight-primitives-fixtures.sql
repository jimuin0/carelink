-- Only a disposable database. All synthetic rows are rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'disposable database required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_overnight(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'overnight fixture: %', label; END IF; END $$;
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES ('faa20001-0000-4000-8000-000000000001','Synthetic','synthetic-night-shift','その他','検証県','検証市','検証町','draft');
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active)
 VALUES ('faa20002-0000-4000-8000-000000000001','faa20001-0000-4000-8000-000000000001','Synthetic','synthetic-night',true);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) VALUES
 ('faa20002-0000-4000-8000-000000000001', 1, '18:00', '24:00'),
 ('faa20002-0000-4000-8000-000000000001', 2, '00:00', '05:00');
SELECT pg_temp.assert_overnight(public.booking_staff_works_interval('faa20002-0000-4000-8000-000000000001','2030-01-07','23:30','2030-01-08','00:30'), 'staff works both dates');
SELECT pg_temp.assert_overnight(NOT public.booking_staff_works_interval('faa20002-0000-4000-8000-000000000001','2030-01-07','23:30','2030-01-08','06:00'), 'end after next shift rejected');
SELECT pg_temp.assert_overnight(public.booking_intervals_conflict('2030-01-07 23:30','2030-01-08 00:30','2030-01-08 00:35','2030-01-08 01:00',10), 'next-day buffer conflicts');
SELECT pg_temp.assert_overnight(NOT public.booking_intervals_conflict('2030-01-07 23:30','2030-01-08 00:30','2030-01-08 00:35','2030-01-08 01:00',5), 'buffer boundary is exclusive');
INSERT INTO public.bookings(id,facility_id,staff_id,booking_date,start_time,end_date,end_time,customer_name,email,status)
 VALUES ('faa20003-0000-4000-8000-000000000001','faa20001-0000-4000-8000-000000000001',
   'faa20002-0000-4000-8000-000000000001','2030-01-07','23:30','2030-01-08','00:30','Synthetic','night@example.invalid','confirmed');
SELECT pg_temp.assert_overnight(public.booking_staff_interval_conflict(
 'faa20001-0000-4000-8000-000000000001','faa20002-0000-4000-8000-000000000001',
 '2030-01-08','00:35','2030-01-08','01:00',10,NULL), 'previous day reservation blocks buffer');
SELECT pg_temp.assert_overnight(NOT public.booking_staff_interval_conflict(
 'faa20001-0000-4000-8000-000000000001','faa20002-0000-4000-8000-000000000001',
 '2030-01-08','00:35','2030-01-08','01:00',10,'faa20003-0000-4000-8000-000000000001'), 'reschedule excludes itself');
SELECT pg_temp.assert_overnight(public.booking_pick_free_staff_interval(
 'faa20001-0000-4000-8000-000000000001','2030-01-08','00:35','2030-01-08','01:00',10,ARRAY[]::uuid[],NULL,NULL) IS NULL,
 'assigned member cannot be picked during a previous-day booking buffer');
SELECT pg_temp.assert_overnight(public.booking_pick_free_staff(
 'faa20001-0000-4000-8000-000000000001','2030-01-08','00:35','01:00',10,ARRAY[]::uuid[],NULL,NULL) IS NULL,
 'existing same-day picker also sees the overnight reservation');
UPDATE public.bookings SET staff_id=NULL WHERE id='faa20003-0000-4000-8000-000000000001';
SELECT pg_temp.assert_overnight(public.booking_unassigned_interval_capacity_full(
 'faa20001-0000-4000-8000-000000000001','2030-01-08','00:35','2030-01-08','01:00',10,NULL),
 'unassigned booking consumes the only working staff member');
SELECT pg_temp.assert_overnight(public.booking_unassigned_capacity_full(
 'faa20001-0000-4000-8000-000000000001','2030-01-08','00:35','01:00',10,NULL),
 'existing same-day unassigned capacity also sees the overnight reservation');
INSERT INTO public.schedule_overrides(staff_id,date,is_holiday) VALUES ('faa20002-0000-4000-8000-000000000001','2030-01-08',true);
SELECT pg_temp.assert_overnight(NOT public.booking_staff_works_interval('faa20002-0000-4000-8000-000000000001','2030-01-07','23:30','2030-01-08','00:30'), 'next-day staff override prevents booking');
ROLLBACK;
