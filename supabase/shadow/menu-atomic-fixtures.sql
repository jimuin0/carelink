\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa780000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_menu(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'menu fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_menu(NOT has_function_privilege('anon','public.delete_admin_menu_atomic(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.reorder_admin_menus_atomic(uuid,uuid,uuid[],uuid[],text)','EXECUTE') AND has_function_privilege('service_role','public.read_admin_menu_snapshot(uuid,uuid)','EXECUTE'),'service only');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa780000-0000-4000-8000-000000000001','menu-owner@example.invalid',now()),('fa780000-0000-4000-8000-000000000002','menu-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('fa780001-0000-4000-8000-000000000001','Menu fixture','synthetic-menu-atomic','その他','検証県','検証市','検証住所','published');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order,price) VALUES
 ('fa780002-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','その他','A',0,1000),
 ('fa780002-0000-4000-8000-000000000002','fa780001-0000-4000-8000-000000000001','その他','B',0,2000);
SET LOCAL ROLE service_role;
DO $$ DECLARE snapshot jsonb; result jsonb; rev text; BEGIN
 snapshot:=public.read_admin_menu_snapshot('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001'); rev:=snapshot->>'revision';
 PERFORM pg_temp.assert_menu(jsonb_array_length(snapshot->'menus')=2,'complete snapshot');
 result:=public.reorder_admin_menus_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001',ARRAY['fa780002-0000-4000-8000-000000000002','fa780002-0000-4000-8000-000000000001']::uuid[],ARRAY['fa780002-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000002']::uuid[],COALESCE(rev,''));
 PERFORM pg_temp.assert_menu(result->>'outcome'='saved','reorder saved');
 PERFORM pg_temp.assert_menu((SELECT sort_order=0 AND price=2000 FROM public.facility_menus WHERE id='fa780002-0000-4000-8000-000000000002'),'ties reordered without changing price');
 BEGIN PERFORM public.reorder_admin_menus_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001',ARRAY['fa780002-0000-4000-8000-000000000002','fa780002-0000-4000-8000-000000000001']::uuid[],ARRAY['fa780002-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000002']::uuid[],COALESCE(rev,'')); RAISE EXCEPTION 'stale replay accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.delete_admin_menu_atomic('fa780000-0000-4000-8000-000000000002','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001'); RAISE EXCEPTION 'wrong actor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.read_admin_menu_snapshot('fa780000-0000-4000-8000-000000000002','fa780001-0000-4000-8000-000000000001'); RAISE EXCEPTION 'wrong actor snapshot'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_menu((SELECT outcome='deleted' FROM public.delete_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001')),'delete one');
 PERFORM pg_temp.assert_menu((SELECT outcome='last_menu' FROM public.delete_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000002')),'published final menu retained');
 PERFORM pg_temp.assert_menu(NOT EXISTS(SELECT 1 FROM public.delete_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001')),'missing is not deleted');
END $$;
RESET ROLE;
INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order) VALUES('fa780002-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','その他','A',1);
CREATE FUNCTION pg_temp.fail_menu() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='fa780002-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'SYNTHETIC_MENU_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_menu_failure BEFORE UPDATE ON public.facility_menus FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_menu();
SET LOCAL ROLE service_role;
DO $$ DECLARE rev text; BEGIN
 SELECT updated_at::text INTO rev FROM public.facility_profiles WHERE id='fa780001-0000-4000-8000-000000000001';
 BEGIN PERFORM public.reorder_admin_menus_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001',ARRAY['fa780002-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000002']::uuid[],ARRAY['fa780002-0000-4000-8000-000000000002','fa780002-0000-4000-8000-000000000001']::uuid[],rev); RAISE EXCEPTION 'fault missed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MENU_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_menu((SELECT sort_order=0 FROM public.facility_menus WHERE id='fa780002-0000-4000-8000-000000000002') AND (SELECT sort_order=1 FROM public.facility_menus WHERE id='fa780002-0000-4000-8000-000000000001'),'all positions rolled back');
 PERFORM pg_temp.assert_menu((SELECT updated_at::text=rev FROM public.facility_profiles WHERE id='fa780001-0000-4000-8000-000000000001'),'revision unchanged after failure');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_menu_failure ON public.facility_menus;
INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order) SELECT md5('menu-atomic-fixture-'||x)::uuid,'fa780001-0000-4000-8000-000000000001','Large','Synthetic '||x,x FROM generate_series(1,1001) x;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_menu(jsonb_array_length(public.read_admin_menu_snapshot('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001')->'menus')=1003,'snapshot exceeds PostgREST row cap');
RESET ROLE;
-- Publication control (20261022120000): an HPB-style draft can be published
-- from the admin write path, an edit that omits the key keeps the current
-- value, and a hand-added menu stays published by default.
UPDATE public.facility_menus SET is_published=false WHERE id='fa780002-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"price":1500}'::jsonb,false,NULL);
 PERFORM pg_temp.assert_menu((result->>'is_published')::boolean=false AND (result->>'price')::integer=1500,'edit without the key keeps a draft unpublished');
 result:=public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"is_published":true}'::jsonb,false,NULL);
 PERFORM pg_temp.assert_menu((result->>'is_published')::boolean AND (result->>'price')::integer=1500 AND result->>'name'='A' AND result->>'category'='その他','publish keeps every other column');
 result:=public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"is_published":false}'::jsonb,false,NULL);
 PERFORM pg_temp.assert_menu(NOT (result->>'is_published')::boolean,'unpublish');
 BEGIN PERFORM public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"is_published":null}'::jsonb,false,NULL); RAISE EXCEPTION 'null publication accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"is_published":"true"}'::jsonb,false,NULL); RAISE EXCEPTION 'string publication accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000002','fa780001-0000-4000-8000-000000000001','fa780002-0000-4000-8000-000000000001','{"is_published":true}'::jsonb,false,NULL); RAISE EXCEPTION 'non-member published a menu'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_menu((SELECT is_published=false FROM public.facility_menus WHERE id='fa780002-0000-4000-8000-000000000001'),'rejected writes leave publication unchanged');
 result:=public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001',NULL,'{"category":"その他","name":"Hand added"}'::jsonb,false,NULL);
 PERFORM pg_temp.assert_menu((result->>'is_published')::boolean,'hand-added menu is published by default');
 result:=public.save_admin_menu_atomic('fa780000-0000-4000-8000-000000000001','fa780001-0000-4000-8000-000000000001',NULL,'{"category":"その他","name":"Hand draft","is_published":false}'::jsonb,false,NULL);
 PERFORM pg_temp.assert_menu(NOT (result->>'is_published')::boolean,'explicit draft creation');
END $$;
RESET ROLE;
ROLLBACK;
