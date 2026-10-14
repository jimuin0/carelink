\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa720000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_usage(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon usage: %',label; END IF; END $$;
SELECT pg_temp.assert_usage(NOT has_function_privilege('anon','public.get_admin_coupon_usage(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.get_admin_coupon_usage(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.get_admin_coupon_usage(uuid,uuid)','EXECUTE'),'service-only aggregation');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa720000-0000-4000-8000-000000000001','coupon-usage-owner@example.invalid',now()),
 ('fa720000-0000-4000-8000-000000000002','coupon-usage-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa720001-0000-4000-8000-000000000001','Usage A','synthetic-coupon-usage-a','その他','検証県','検証市','検証住所','draft'),
 ('fa720001-0000-4000-8000-000000000002','Usage B','synthetic-coupon-usage-b','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001','owner');
INSERT INTO public.coupons(id,facility_id,name) VALUES
 ('fa720003-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001','Used'),
 ('fa720003-0000-4000-8000-000000000002','fa720001-0000-4000-8000-000000000001','Unused'),
 ('fa720003-0000-4000-8000-000000000003','fa720001-0000-4000-8000-000000000002','Other');
INSERT INTO public.coupon_redemptions(coupon_id) SELECT 'fa720003-0000-4000-8000-000000000001'::uuid FROM generate_series(1,1001);
INSERT INTO public.coupon_redemptions(coupon_id) VALUES('fa720003-0000-4000-8000-000000000003');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_usage((SELECT usage_count=1001 FROM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001') WHERE coupon_id='fa720003-0000-4000-8000-000000000001'),'counts exceed API row cap without truncation');
SELECT pg_temp.assert_usage((SELECT usage_count=0 FROM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001') WHERE coupon_id='fa720003-0000-4000-8000-000000000002'),'confirmed unused is zero');
SELECT pg_temp.assert_usage((SELECT count(*)=2 FROM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001')),'other store excluded');
DO $$ BEGIN
 BEGIN PERFORM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000002','fa720001-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'other actor allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'other store allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.facility_members SET role='staff' WHERE user_id='fa720000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.get_admin_coupon_usage('fa720000-0000-4000-8000-000000000001','fa720001-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'revoked manager allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
