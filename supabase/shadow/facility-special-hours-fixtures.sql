-- Disposable database only; no real facilities or external side effects.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'disposable database required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_special(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'special-hours fixture: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.try_special(statement text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

SELECT pg_temp.assert_special(
  has_function_privilege('service_role', 'public.save_facility_special_hours_atomic(uuid,uuid,boolean,boolean,date[],integer,timestamptz,date[],date,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.save_facility_special_hours_atomic(uuid,uuid,boolean,boolean,date[],integer,timestamptz,date[],date,date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.save_facility_special_hours_atomic(uuid,uuid,boolean,boolean,date[],integer,timestamptz,date[],date,date)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.facility_special_hours', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.facility_special_hours', 'UPDATE'), 'no direct client access');

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('faa10000-0000-4000-8000-000000000001', 'special-a@example.invalid', now()),
 ('faa10000-0000-4000-8000-000000000002', 'special-b@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
 ('faa10001-0000-4000-8000-000000000001', 'Synthetic A', 'synthetic-special-a', 'その他', '検証県', '検証市', '検証町1', 'draft'),
 ('faa10001-0000-4000-8000-000000000002', 'Synthetic B', 'synthetic-special-b', 'その他', '検証県', '検証市', '検証町2', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
 ('faa10000-0000-4000-8000-000000000001', 'faa10001-0000-4000-8000-000000000001', 'owner'),
 ('faa10000-0000-4000-8000-000000000002', 'faa10001-0000-4000-8000-000000000002', 'owner');
INSERT INTO public.bookings(facility_id, booking_date, start_time, end_time, customer_name, email, status)
 VALUES ('faa10001-0000-4000-8000-000000000001', (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date + 7,
   '10:00', '11:00', 'Synthetic', 'special-booking@example.invalid', 'confirmed');
SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid := 'faa10000-0000-4000-8000-000000000001';
  f uuid := 'faa10001-0000-4000-8000-000000000001';
  other uuid := 'faa10001-0000-4000-8000-000000000002';
  rev timestamptz; result text;
BEGIN
  PERFORM public.save_facility_special_hours_atomic(a, f, false, true, ARRAY['2020-01-01'::date], 15, NULL, ARRAY[]::date[], '2020-01-01', '2100-12-31');
  SELECT updated_at INTO rev FROM public.facility_special_hours WHERE facility_id = f;
  PERFORM pg_temp.assert_special(rev IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_special_hours WHERE facility_id = other), 'saving A does not touch B');
  result := pg_temp.try_special(format('SELECT public.save_facility_special_hours_atomic(%L,%L,false,false,ARRAY[]::date[],NULL,NULL,NULL,NULL,NULL)', a, f));
  PERFORM pg_temp.assert_special(result = 'SPECIAL_HOURS_CHANGED', 'stale writer refused');
  result := pg_temp.try_special(format('SELECT public.save_facility_special_hours_atomic(%L,%L,false,false,ARRAY[]::date[],NULL,NULL,NULL,NULL,NULL)', a, other));
  PERFORM pg_temp.assert_special(result = 'FACILITY_PERMISSION_REVOKED', 'other store cannot be edited');
  result := pg_temp.try_special(format('SELECT public.save_facility_special_hours_atomic(%L,%L,false,false,ARRAY[%L,%L]::date[],15,%L,NULL,NULL,NULL)', a, f, '2020-01-01', '2020-01-01', rev));
  PERFORM pg_temp.assert_special(result = 'INVALID_SPECIAL_HOURS', 'duplicate dates refused');
  result := pg_temp.try_special(format('SELECT public.save_facility_special_hours_atomic(%L,%L,false,false,ARRAY[%L]::date[],NULL,%L,NULL,NULL,NULL)', a, f,
    (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date + 7, rev));
  PERFORM pg_temp.assert_special(result = 'SPECIAL_HOURS_HAS_BOOKINGS', 'existing booking prevents a new closure');
  PERFORM public.save_facility_special_hours_atomic(a, f, false, false, ARRAY[]::date[], NULL, rev, NULL, NULL, NULL);
  PERFORM pg_temp.assert_special((SELECT NOT close_on_public_holidays AND cardinality(closed_dates)=0
    AND reception_cutoff_minutes IS NULL FROM public.facility_special_hours WHERE facility_id=f), 'authorized save changes only the chosen facility');
END $$;
RESET ROLE;
UPDATE public.facility_profiles SET business_hours='{"mon":{"open":"18:00","close":"05:00"},"tue":{"open":"09:00","close":"17:00"},"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'::jsonb
 WHERE id='faa10001-0000-4000-8000-000000000001';
UPDATE public.facility_special_hours SET closed_dates=ARRAY[]::date[], close_on_public_holidays=false, reception_cutoff_minutes=15
 WHERE facility_id='faa10001-0000-4000-8000-000000000001';
SELECT pg_temp.assert_special((SELECT count(*)=1 AND min(start_min)=1080 AND max(end_min)=1440
 FROM public.facility_reception_windows_for_date('faa10001-0000-4000-8000-000000000001','2030-01-07',NULL,NULL,NULL)),
 'overnight reception does not stop early at midnight');
SELECT pg_temp.assert_special(EXISTS(SELECT 1 FROM public.facility_reception_windows_for_date(
 'faa10001-0000-4000-8000-000000000001','2030-01-08',NULL,NULL,NULL) WHERE start_min=0 AND end_min=285),
 'next-day reception ends fifteen minutes before real closing');
UPDATE public.facility_special_hours SET closed_dates=ARRAY['2030-01-08'::date]
 WHERE facility_id='faa10001-0000-4000-8000-000000000001';
SELECT pg_temp.assert_special((SELECT count(*)=1 AND min(start_min)=1080 AND max(end_min)=1425
 FROM public.facility_reception_windows_for_date('faa10001-0000-4000-8000-000000000001','2030-01-07',NULL,NULL,NULL)),
 'next-day closure moves reception cutoff to before midnight');
UPDATE public.facility_special_hours SET closed_dates=ARRAY['2030-01-07'::date], close_on_public_holidays=false
 WHERE facility_id='faa10001-0000-4000-8000-000000000001';
SELECT pg_temp.assert_special((SELECT count(*)=1 AND min(start_min)=540 AND max(end_min)=1020
 FROM public.facility_business_windows_for_date('faa10001-0000-4000-8000-000000000001','2030-01-08',NULL,NULL,NULL)),
 'previous closure removes overnight tail but keeps today opening');
UPDATE public.facility_special_hours SET closed_dates=ARRAY[]::date[], close_on_public_holidays=true
 WHERE facility_id='faa10001-0000-4000-8000-000000000001';
SELECT pg_temp.assert_special((SELECT count(*)=0 FROM public.facility_business_windows_for_date(
 'faa10001-0000-4000-8000-000000000001','2030-01-08',ARRAY['2030-01-08'::date],'2030-01-01','2030-12-31')),
 'explicitly selected holiday closes the day');
SELECT pg_temp.assert_special(pg_temp.try_special($statement$ SELECT * FROM public.facility_business_windows_for_date(
 'faa10001-0000-4000-8000-000000000001','2030-01-08',NULL,NULL,NULL) $statement$)='HOLIDAY_CALENDAR_UNAVAILABLE',
 'unknown holiday data is not treated as an ordinary day');
ROLLBACK;
