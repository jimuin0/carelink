\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa700000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_coupon(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon atomic: %',label; END IF; END $$;
SELECT pg_temp.assert_coupon(NOT has_function_privilege('anon','public.save_admin_coupon_atomic(uuid,uuid,uuid,jsonb,uuid[])','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.save_admin_coupon_atomic(uuid,uuid,uuid,jsonb,uuid[])','EXECUTE')
 AND has_function_privilege('service_role','public.save_admin_coupon_atomic(uuid,uuid,uuid,jsonb,uuid[])','EXECUTE'),'service-only gateway');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa700000-0000-4000-8000-000000000001','coupon-owner@example.invalid',now()),
 ('fa700000-0000-4000-8000-000000000002','coupon-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa700001-0000-4000-8000-000000000001','Coupon A','synthetic-coupon-atomic-a','その他','検証県','検証市','検証住所','draft'),
 ('fa700001-0000-4000-8000-000000000002','Coupon B','synthetic-coupon-atomic-b','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_menus(id,facility_id,name,category,price) VALUES
 ('fa700002-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001','A','その他',1000),
 ('fa700002-0000-4000-8000-000000000002','fa700001-0000-4000-8000-000000000001','B','その他',2000),
 ('fa700002-0000-4000-8000-000000000003','fa700001-0000-4000-8000-000000000002','Other','その他',1000);
CREATE TEMP TABLE coupon_fixture_receipt(id uuid);
GRANT ALL ON coupon_fixture_receipt TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO coupon_fixture_receipt SELECT id FROM public.save_admin_coupon_atomic(
 'fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',NULL,
 '{"name":"Limited","discount_type":"fixed","discount_value":500}',ARRAY['fa700002-0000-4000-8000-000000000001'::uuid]);
SELECT pg_temp.assert_coupon((SELECT count(*)=1 FROM public.coupon_menus WHERE coupon_id=(SELECT id FROM coupon_fixture_receipt)),'creation saves restriction');
SELECT pg_temp.assert_coupon((SELECT is_active=true AND special_price IS NULL FROM public.coupons WHERE id=(SELECT id FROM coupon_fixture_receipt)),'creation defaults preserved');
SELECT * FROM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',(SELECT id FROM coupon_fixture_receipt),'{"description":"Changed"}',NULL);
SELECT pg_temp.assert_coupon((SELECT menu_id='fa700002-0000-4000-8000-000000000001' FROM public.coupon_menus WHERE coupon_id=(SELECT id FROM coupon_fixture_receipt)),'omitted targets preserve restriction');
DO $$ BEGIN
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000002','fa700001-0000-4000-8000-000000000001',NULL,'{"name":"Denied","discount_type":"fixed","discount_value":500}',NULL);
  RAISE EXCEPTION 'wrong actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',(SELECT id FROM coupon_fixture_receipt),'{"name":"Wrong menu"}',ARRAY['fa700002-0000-4000-8000-000000000003'::uuid]);
  RAISE EXCEPTION 'foreign menu accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',(SELECT id FROM coupon_fixture_receipt),'{"name":"Duplicate"}',ARRAY['fa700002-0000-4000-8000-000000000001'::uuid,'fa700002-0000-4000-8000-000000000001'::uuid]);
  RAISE EXCEPTION 'duplicate menu accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',NULL,'{"name":"Bad percentage","discount_type":"percentage","discount_value":101}',NULL);
  RAISE EXCEPTION 'invalid discount accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT pg_temp.assert_coupon((SELECT name='Limited' FROM public.coupons WHERE id=(SELECT id FROM coupon_fixture_receipt)),'invalid target cannot partially change coupon');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_coupon_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.menu_id='fa700002-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'SYNTHETIC_MAPPING_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_coupon_mapping_failure BEFORE INSERT ON public.coupon_menus FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_coupon_mapping();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',NULL,'{"name":"Failed create","discount_type":"fixed","discount_value":500}',ARRAY['fa700002-0000-4000-8000-000000000002'::uuid]);
  RAISE EXCEPTION 'injected create failure missed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MAPPING_FAILURE' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',(SELECT id FROM coupon_fixture_receipt),'{"name":"Failed update","discount_type":"percentage","discount_value":25}',ARRAY['fa700002-0000-4000-8000-000000000002'::uuid]);
  RAISE EXCEPTION 'injected update failure missed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MAPPING_FAILURE' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_coupon(NOT EXISTS(SELECT 1 FROM public.coupons WHERE facility_id='fa700001-0000-4000-8000-000000000001' AND name='Failed create'),'failed creation leaves no all-menu coupon');
SELECT pg_temp.assert_coupon((SELECT name='Limited' AND discount_type='fixed' AND discount_value=500 AND is_active=true FROM public.coupons WHERE id=(SELECT id FROM coupon_fixture_receipt)),'failed update rolls back fields without emergency deactivation');
SELECT pg_temp.assert_coupon((SELECT count(*)=1 AND bool_and(menu_id='fa700002-0000-4000-8000-000000000001') FROM public.coupon_menus WHERE coupon_id=(SELECT id FROM coupon_fixture_receipt)),'failed replacement restores original menu restriction');
SELECT pg_temp.assert_coupon(NOT EXISTS(SELECT 1 FROM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001','fa700003-0000-4000-8000-000000000099','{}',NULL)),'deleted coupon yields no success receipt');
SELECT * FROM public.save_admin_coupon_atomic('fa700000-0000-4000-8000-000000000001','fa700001-0000-4000-8000-000000000001',(SELECT id FROM coupon_fixture_receipt),'{}',ARRAY[]::uuid[]);
SELECT pg_temp.assert_coupon(NOT EXISTS(SELECT 1 FROM public.coupon_menus WHERE coupon_id=(SELECT id FROM coupon_fixture_receipt)),'explicit empty targets removes restriction');
RESET ROLE;
ROLLBACK;
