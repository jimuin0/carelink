-- Synthetic, rollback-only. Never run against a live customer database.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_manual_20261001')
  THEN RAISE EXCEPTION 'disposable shadow database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_manual(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'manual booking fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('c1000000-0000-4000-8000-000000000001','manual-owner@example.invalid',now()),
('c1000000-0000-4000-8000-000000000002','manual-admin@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
('c2000000-0000-4000-8000-000000000001','Synthetic manual','synthetic-manual','その他','検証県','検証市','検証住所','draft'),
('c2000000-0000-4000-8000-000000000002','Other','synthetic-manual-other','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','owner'),
('c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','admin');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES
('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','synthetic','First',3000,30,false),
('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','synthetic','Second',2000,30,false),
('c3000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000002','synthetic','Other',0,30,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,nomination_fee) VALUES
('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic','synthetic',1000),
('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Other','other',0);
CREATE FUNCTION pg_temp.manual_input() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'facility_id','c2000000-0000-4000-8000-000000000001','staff_id','c4000000-0000-4000-8000-000000000001',
  'menu_ids',jsonb_build_array('c3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001'),
  'booking_date','2030-01-07','start_time','10:00','end_time','11:00','customer_name','Synthetic',
  'email',NULL,'phone',NULL,'note',NULL); $$;
CREATE FUNCTION pg_temp.manual_create(op integer,value jsonb DEFAULT pg_temp.manual_input(),actor uuid DEFAULT 'c1000000-0000-4000-8000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.create_manual_booking_atomic(actor,
  ('c5000000-0000-4000-8000-'||lpad(op::text,12,'0'))::uuid,value); $$;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['public.create_manual_booking_atomic(uuid,uuid,jsonb)','public.get_manual_booking_operation(uuid,uuid,uuid)'] LOOP
    PERFORM pg_temp.assert_manual(has_function_privilege('service_role',signature,'EXECUTE')
      AND NOT has_function_privilege('anon',signature,'EXECUTE')
      AND NOT has_function_privilege('authenticated',signature,'EXECUTE'),'service-only RPC');
  END LOOP;
  PERFORM pg_temp.assert_manual(NOT has_table_privilege('anon','public.manual_booking_operations','SELECT')
    AND NOT has_table_privilege('authenticated','public.manual_booking_operations','INSERT')
    AND NOT has_table_privilege('service_role','public.manual_booking_operations','DELETE')
    AND NOT has_table_privilege('service_role','public.manual_booking_operations','UPDATE'),'private immutable intent');
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE first jsonb; second jsonb; BEGIN
  first := pg_temp.manual_create(1);
  second := pg_temp.manual_create(1);
  PERFORM pg_temp.assert_manual(first->>'booking_id'=second->>'booking_id' AND second->>'replayed'='true','same ID replay');
  PERFORM pg_temp.assert_manual((first->>'total_price')::int=6000 AND first->>'menu_names'='Second、First','price and chosen order');
  PERFORM pg_temp.assert_manual((SELECT menu_ids=ARRAY['c3000000-0000-4000-8000-000000000002'::uuid,'c3000000-0000-4000-8000-000000000001'::uuid]
    AND user_id IS NULL AND email IS NULL FROM public.bookings WHERE id=(first->>'booking_id')::uuid),'all menus and optional email');
  BEGIN PERFORM pg_temp.manual_create(1,pg_temp.manual_input()||'{"customer_name":"Changed"}');
    RAISE EXCEPTION 'changed operation accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MANUAL_OPERATION_CONFLICT' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.manual_create(1,pg_temp.manual_input(),'c1000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'other actor replay accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MANUAL_OPERATION_CONFLICT' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.manual_create(2);
    RAISE EXCEPTION 'overlap accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BOOKING_CONFLICT%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_manual((SELECT count(*)=1 FROM public.bookings WHERE facility_id='c2000000-0000-4000-8000-000000000001')
    AND (SELECT count(*)=1 FROM public.manual_booking_operations),'one reservation and operation only');
  PERFORM pg_temp.assert_manual(public.get_manual_booking_operation('c1000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'state'='saved','reload recovery');
END $$;
RESET ROLE;
UPDATE public.facility_menus SET price=1 WHERE facility_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_manual((pg_temp.manual_create(1)->>'total_price')::int=6000,'replay retains committed price');
DO $$ DECLARE value jsonb; BEGIN
  FOREACH value IN ARRAY ARRAY[
    pg_temp.manual_input()||'{"menu_ids":["c3000000-0000-4000-8000-000000000003"]}',
    pg_temp.manual_input()||'{"staff_id":"c4000000-0000-4000-8000-000000000002"}',
    pg_temp.manual_input()||'{"menu_ids":[]}',pg_temp.manual_input()||'{"start_time":"24:00"}',
    pg_temp.manual_input()||'{"customer_name":""}',pg_temp.manual_input()||'{"unknown":"value"}'
  ] LOOP
    BEGIN PERFORM pg_temp.manual_create(2,CASE WHEN value->>'start_time'='24:00' THEN value
      ELSE value||'{"start_time":"12:00","end_time":"13:00"}' END);
      RAISE EXCEPTION 'invalid input accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('MANUAL_INPUT_INVALID','MANUAL_MENU_UNAVAILABLE','MANUAL_STAFF_UNAVAILABLE') THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
RESET ROLE;
-- A menu persistence failure rolls back the booking and its operation record.
CREATE FUNCTION pg_temp.reject_manual_menu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SYNTHETIC_MANUAL_MENU_FAILURE'; END $$;
CREATE TRIGGER synthetic_manual_menu_failure BEFORE UPDATE OF menu_ids ON public.bookings
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_manual_menu();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM pg_temp.manual_create(2,pg_temp.manual_input()||'{"start_time":"12:00","end_time":"13:00"}');
    RAISE EXCEPTION 'partial menu write accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MANUAL_MENU_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_manual((SELECT count(*)=1 FROM public.bookings WHERE facility_id='c2000000-0000-4000-8000-000000000001')
    AND (SELECT count(*)=1 FROM public.manual_booking_operations),'booking and operation rollback');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_manual_menu_failure ON public.bookings;
UPDATE public.facility_members SET role='staff' WHERE user_id='c1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM pg_temp.manual_create(1); RAISE EXCEPTION 'revoked replay accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.facility_members SET role='owner' WHERE user_id='c1000000-0000-4000-8000-000000000001';
DELETE FROM public.bookings WHERE facility_id='c2000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM pg_temp.assert_manual(public.get_manual_booking_operation('c1000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001')->>'state'='retired','deleted reservation tombstone');
  BEGIN PERFORM pg_temp.manual_create(1); RAISE EXCEPTION 'deleted reservation recreated';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MANUAL_OPERATION_RETIRED' THEN RAISE; END IF; END;
END $$;
-- Notification reservation is part of the business commit, even when the API
-- process never gets to run after RPC return. Same operation has only one job.
SELECT pg_temp.manual_create(3,pg_temp.manual_input()||'{"email":"synthetic@example.invalid","start_time":"12:00","end_time":"13:00"}');
SELECT pg_temp.manual_create(3,pg_temp.manual_input()||'{"email":"synthetic@example.invalid","start_time":"12:00","end_time":"13:00"}');
SELECT pg_temp.assert_manual((SELECT count(*)=1 FROM public.webhook_retry_queue
  WHERE id='c5000000-0000-4000-8000-000000000003' AND webhook_type='manual_booking_confirmation'), 'one atomic notification event');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_manual_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SYNTHETIC_MANUAL_OUTBOX_FAILURE'; END $$;
CREATE TRIGGER synthetic_manual_outbox_failure BEFORE INSERT ON public.webhook_retry_queue
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_manual_outbox();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM pg_temp.manual_create(4,pg_temp.manual_input()||'{"email":"synthetic@example.invalid","start_time":"14:00","end_time":"15:00"}');
    RAISE EXCEPTION 'missing atomic notification accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MANUAL_OUTBOX_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_manual(NOT EXISTS(SELECT 1 FROM public.bookings WHERE start_time='14:00'
    AND facility_id='c2000000-0000-4000-8000-000000000001')
    AND NOT EXISTS(SELECT 1 FROM public.manual_booking_operations WHERE operation_id='c5000000-0000-4000-8000-000000000004'), 'outbox failure rolls back booking and operation');
END $$;
ROLLBACK;
