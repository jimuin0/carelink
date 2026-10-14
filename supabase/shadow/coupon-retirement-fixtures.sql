\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa750000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_retire(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon retirement: %',label; END IF; END $$;
SELECT pg_temp.assert_retire(NOT has_function_privilege('anon','public.retire_admin_coupon_atomic(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.retire_admin_coupon_atomic(uuid,uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.retire_admin_coupon_atomic(uuid,uuid,uuid)','EXECUTE'),'service-only retirement');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa750000-0000-4000-8000-000000000001','coupon-retire-owner@example.invalid',now()),
 ('fa750000-0000-4000-8000-000000000002','coupon-retire-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa750001-0000-4000-8000-000000000001','Retirement','synthetic-coupon-retire','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','owner');
INSERT INTO public.coupons(id,facility_id,name) VALUES
 ('fa750003-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','Unused'),
 ('fa750003-0000-4000-8000-000000000002','fa750001-0000-4000-8000-000000000001','Redeemed'),
 ('fa750003-0000-4000-8000-000000000003','fa750001-0000-4000-8000-000000000001','Booked'),
 ('fa750003-0000-4000-8000-000000000004','fa750001-0000-4000-8000-000000000001','Failure');
INSERT INTO public.coupon_redemptions(coupon_id) VALUES('fa750003-0000-4000-8000-000000000002');
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(facility_id,coupon_id,booking_date,start_time,end_time,customer_name,status,total_price,points_used) VALUES
 ('fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000003','2030-01-07','10:00','11:00','Synthetic','completed',1000,0);
SELECT pg_temp.assert_retire((SELECT outcome='deleted' FROM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000001')),'unused deleted');
SELECT pg_temp.assert_retire(NOT EXISTS(SELECT 1 FROM public.coupons WHERE id='fa750003-0000-4000-8000-000000000001'),'unused absent');
SELECT pg_temp.assert_retire((SELECT outcome='deactivated' FROM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000002')),'redeemed deactivated');
SELECT pg_temp.assert_retire((SELECT count(*)=1 FROM public.coupon_redemptions WHERE coupon_id='fa750003-0000-4000-8000-000000000002'),'redemption preserved');
SELECT pg_temp.assert_retire((SELECT outcome='deactivated' FROM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000003')),'booking reference deactivated even before redemption');
SELECT pg_temp.assert_retire((SELECT count(*)=1 FROM public.bookings WHERE coupon_id='fa750003-0000-4000-8000-000000000003'),'booking coupon reference preserved');
SELECT pg_temp.assert_retire(NOT EXISTS(SELECT 1 FROM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000001')),'missing row is not success');
DO $$ BEGIN
 BEGIN PERFORM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000002','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000004');
  RAISE EXCEPTION 'other actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_retire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.id='fa750003-0000-4000-8000-000000000004' THEN RAISE EXCEPTION 'SYNTHETIC_RETIRE_FAILURE'; END IF; RETURN OLD; END $$;
CREATE TRIGGER synthetic_coupon_retire_failure BEFORE DELETE ON public.coupons FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_retire();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.retire_admin_coupon_atomic('fa750000-0000-4000-8000-000000000001','fa750001-0000-4000-8000-000000000001','fa750003-0000-4000-8000-000000000004');
  RAISE EXCEPTION 'failure missed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_RETIRE_FAILURE' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_retire((SELECT is_active=true FROM public.coupons WHERE id='fa750003-0000-4000-8000-000000000004'),'failure preserves original coupon');
RESET ROLE;
ROLLBACK;
