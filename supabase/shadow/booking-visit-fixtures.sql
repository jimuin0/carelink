-- Transactional synthetic fixtures for all completion callers' shared DB gate.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_manual_20261001')
 THEN RAISE EXCEPTION 'disposable shadow database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_visit(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking visit fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa100000-0000-4000-8000-000000000001','visit-owner@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('fa200000-0000-4000-8000-000000000001','Visit synthetic','visit-synthetic','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role)
 VALUES('fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes)
 VALUES('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','synthetic','First',1000,30),
 ('fa300000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000001','synthetic','Second',2000,30);
INSERT INTO public.bookings(id,facility_id,menu_id,menu_ids,booking_date,start_time,end_time,customer_name,email,status,total_price)
 SELECT ('fa400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa200000-0000-4000-8000-000000000001',
 'fa300000-0000-4000-8000-000000000001',ARRAY['fa300000-0000-4000-8000-000000000001'::uuid,'fa300000-0000-4000-8000-000000000002'::uuid],
 '2030-01-07',make_time(8+n,0,0),make_time(9+n,0,0),'Same synthetic name',
 CASE WHEN n=3 THEN 'visit@example.invalid' ELSE NULL END,'confirmed',3000 FROM generate_series(1,3)n;
SET LOCAL ROLE service_role;
UPDATE public.bookings SET status='completed',total_price=4321 WHERE facility_id='fa200000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_visit((SELECT count(*)=3 AND count(customer_email)=1 AND min(amount)=4321
 AND bool_and(menu_name='First、Second') FROM public.customer_visits WHERE facility_id='fa200000-0000-4000-8000-000000000001'),
 'email-less visits remain separate; final checkout amount and all menus');
UPDATE public.bookings SET status='completed' WHERE facility_id='fa200000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_visit((SELECT count(*)=3 FROM public.customer_visits WHERE facility_id='fa200000-0000-4000-8000-000000000001'),'repeated completion remains unique');
SELECT pg_temp.assert_visit((SELECT count(*)=1 AND max(visit_count)=1 FROM public.get_unique_customers('fa200000-0000-4000-8000-000000000001')),'no null or name-based customer merge');
UPDATE public.bookings SET status='confirmed' WHERE id='fa400000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_visit((SELECT count(*)=2 FROM public.customer_visits WHERE facility_id='fa200000-0000-4000-8000-000000000001'),'reversal removes only original visit');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_visit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_VISIT_FAILURE'; END $$;
CREATE TRIGGER synthetic_visit_failure BEFORE INSERT ON public.customer_visits FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_visit();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN UPDATE public.bookings SET status='completed' WHERE id='fa400000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'visit insert failure accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_VISIT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_visit((SELECT status='confirmed' FROM public.bookings WHERE id='fa400000-0000-4000-8000-000000000001'),'insert failure rolls back status');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_visit_failure ON public.customer_visits;
CREATE TRIGGER synthetic_visit_delete_failure BEFORE DELETE ON public.customer_visits FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_visit();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN UPDATE public.bookings SET status='no_show' WHERE id='fa400000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'visit delete failure accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_VISIT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_visit((SELECT status='completed' FROM public.bookings WHERE id='fa400000-0000-4000-8000-000000000002')
  AND EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id='fa400000-0000-4000-8000-000000000002'),'delete failure rolls back status and retains visit');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_visit_delete_failure ON public.customer_visits;
SELECT set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
-- The bootstrap intentionally returns NULL. Reproduce the real identity only
-- inside this rollback transaction, so authorization tests are not vacuous.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
SET LOCAL ROLE authenticated;
INSERT INTO public.customer_visits(facility_id,customer_email,customer_name,visit_date)
 VALUES('fa200000-0000-4000-8000-000000000001','manual-history@example.invalid','Allowed unlinked manual history','2030-01-07');
DO $$ BEGIN
 BEGIN INSERT INTO public.customer_visits(facility_id,booking_id,customer_email,customer_name,visit_date)
  VALUES('fa200000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001',NULL,'Forged','2030-01-07');
  RAISE EXCEPTION 'forged booking visit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM public.customer_visits WHERE facility_id='fa200000-0000-4000-8000-000000000001' AND customer_email='manual-history@example.invalid';
-- Reservation deletion retains actual visit history via ON DELETE SET NULL.
DELETE FROM public.bookings WHERE id='fa400000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_visit((SELECT count(*)=2 AND count(booking_id)=1 FROM public.customer_visits
 WHERE facility_id='fa200000-0000-4000-8000-000000000001'),'booking deletion retains historical visit');
ROLLBACK;
