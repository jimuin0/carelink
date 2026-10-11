-- Synthetic receipt/notification/point invariants; all business rows roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_shadow_batch2_points','postgres') THEN RAISE EXCEPTION 'isolated database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_create(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking receipt fixture: %',label; END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('bea40000-0000-4000-8000-000000000001','receipt-owner@example.invalid',now()),
 ('bea40000-0000-4000-8000-000000000002','receipt-actor@example.invalid',now()),
 ('bea40000-0000-4000-8000-000000000003','receipt-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours)
VALUES('bea41000-0000-4000-8000-000000000001','Receipt synthetic','receipt-synthetic','その他','検証県','検証市','検証住所','draft',
 '{"mon":{"open":"09:00","close":"17:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('bea40000-0000-4000-8000-000000000001','bea41000-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES('bea42000-0000-4000-8000-000000000001','bea41000-0000-4000-8000-000000000001','synthetic','Synthetic',500,30,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active) VALUES('bea43000-0000-4000-8000-000000000001','bea41000-0000-4000-8000-000000000001','Synthetic','receipt-staff',true);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) VALUES('bea43000-0000-4000-8000-000000000001',1,'09:00','17:00');
INSERT INTO public.facility_photos(facility_id,photo_url,photo_type) VALUES('bea41000-0000-4000-8000-000000000001','https://example.invalid/receipt.jpg','other');
UPDATE public.facility_profiles SET status='published' WHERE id='bea41000-0000-4000-8000-000000000001';
INSERT INTO public.user_points(user_id,points,reason) VALUES('bea40000-0000-4000-8000-000000000002',500,'Synthetic seed');
UPDATE public.profiles SET email=NULL WHERE id='bea40000-0000-4000-8000-000000000001';
INSERT INTO public.facility_notification_settings(facility_id,push_on_new_booking) VALUES('bea41000-0000-4000-8000-000000000001',false);
CREATE FUNCTION pg_temp.receipt_create(p_id uuid,p_start time DEFAULT '10:00',p_notifications jsonb DEFAULT '[{"kind":"email","role":"customer","target":"proxy@example.invalid","envelope":{"from":"test@example.invalid","to":"proxy@example.invalid","subject":"Synthetic receipt","html":"<p>Synthetic</p>"}}]')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE snap jsonb; plan jsonb; BEGIN
 snap:=jsonb_build_object('customer_name','Synthetic','email','proxy@example.invalid','facility_name','Receipt synthetic','menu_name','Synthetic','staff_name','Synthetic','booking_date','2030-01-07','start_time',to_char(p_start,'HH24:MI'),'end_time',to_char(p_start+interval '30 minutes','HH24:MI'),'total_price',400,'status','confirmed');
 SELECT jsonb_agg(x.value||jsonb_build_object('snapshot',snap,'context',jsonb_build_object('owner_ids',jsonb_build_array('bea40000-0000-4000-8000-000000000001'),'owner_push',false,'works_enabled',false,'line_enabled',false))) INTO plan FROM jsonb_array_elements(p_notifications) x;
 plan:=plan||jsonb_build_array(jsonb_build_object('kind','push','role','customer','target','bea40000-0000-4000-8000-000000000002','payload',jsonb_build_object('title','Synthetic','body','Synthetic'),'snapshot',snap));
 RETURN (SELECT response_payload FROM public.create_booking_with_receipt_atomic(p_id,'bea40000-0000-4000-8000-000000000002',NULL,repeat('a',64),
 'bea41000-0000-4000-8000-000000000001','bea43000-0000-4000-8000-000000000001','bea42000-0000-4000-8000-000000000001',NULL,
 '2030-01-07',p_start,p_start+interval '30 minutes','Synthetic','proxy@example.invalid',NULL,NULL,400,100,'confirmed',ARRAY['bea42000-0000-4000-8000-000000000001'::uuid],plan));
END $$;
CREATE FUNCTION pg_temp.claim_receipt(qid uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM * FROM public.claim_webhook_retry_queue_v2(ARRAY[qid],'2030-01-01T00:00Z');
END $$;
SELECT pg_temp.assert_create(NOT has_function_privilege('anon','public.prepare_booking_create_operation(uuid,uuid,text,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.inspect_booking_create_operation(uuid,uuid,text,boolean)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])','EXECUTE'),'service receipt required and public actors cannot forge');
SET LOCAL ROLE service_role;
SELECT * FROM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000001','bea40000-0000-4000-8000-000000000002',NULL,'bea41000-0000-4000-8000-000000000001',repeat('a',64));
SELECT pg_temp.assert_create(pg_temp.receipt_create('bea44000-0000-4000-8000-000000000001')->>'state'='accepted','create confirmed');
SELECT pg_temp.assert_create((SELECT count(*)=1 FROM public.bookings WHERE facility_id='bea41000-0000-4000-8000-000000000001')
 AND (SELECT sum(points)=400 FROM public.user_points WHERE user_id='bea40000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=2 FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000001'),'booking/debit/queue single commit');
-- A replay ignores stale notification plans and neither spends nor queues twice.
SELECT pg_temp.assert_create(pg_temp.receipt_create('bea44000-0000-4000-8000-000000000001','10:00',NULL)->>'state'='accepted','replay accepted');
SELECT pg_temp.assert_create((SELECT count(*)=1 FROM public.bookings WHERE facility_id='bea41000-0000-4000-8000-000000000001')
 AND (SELECT sum(points)=400 FROM public.user_points WHERE user_id='bea40000-0000-4000-8000-000000000002'),'replay preserves count/balance');
DO $$ BEGIN
 BEGIN PERFORM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000001','bea40000-0000-4000-8000-000000000002',NULL,'bea41000-0000-4000-8000-000000000001',repeat('b',64)); RAISE EXCEPTION 'changed payload accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CREATE_PAYLOAD_CONFLICT' THEN RAISE; END IF; END;
 BEGIN PERFORM public.inspect_booking_create_operation('bea44000-0000-4000-8000-000000000001','bea40000-0000-4000-8000-000000000003',NULL,false); RAISE EXCEPTION 'wrong actor accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CREATE_SCOPE_CONFLICT' THEN RAISE; END IF; END;
END $$;
SELECT * FROM public.inspect_booking_create_operation('bea44000-0000-4000-8000-000000000002','bea40000-0000-4000-8000-000000000002',NULL,true);
DO $$ BEGIN
 BEGIN PERFORM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000002','bea40000-0000-4000-8000-000000000002',NULL,'bea41000-0000-4000-8000-000000000001',repeat('a',64)); RAISE EXCEPTION 'delayed prepare reopened';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CREATE_CLOSED' THEN RAISE; END IF; END;
END $$;
SELECT * FROM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000003',NULL,repeat('c',64),'bea41000-0000-4000-8000-000000000001',repeat('a',64));
DO $$ BEGIN
 BEGIN PERFORM public.inspect_booking_create_operation('bea44000-0000-4000-8000-000000000003',NULL,repeat('d',64),false); RAISE EXCEPTION 'wrong guest scope accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CREATE_SCOPE_CONFLICT' THEN RAISE; END IF; END;
END $$;
SELECT * FROM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000004','bea40000-0000-4000-8000-000000000002',NULL,'bea41000-0000-4000-8000-000000000001',repeat('a',64));
RESET ROLE;
CREATE FUNCTION pg_temp.fail_receipt_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000004' THEN RAISE EXCEPTION 'SYNTHETIC_QUEUE_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_receipt_queue_failure BEFORE INSERT ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt_queue();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.receipt_create('bea44000-0000-4000-8000-000000000004','11:00'); RAISE EXCEPTION 'queue failure accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_QUEUE_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_create((SELECT sum(points)=400 FROM public.user_points WHERE user_id='bea40000-0000-4000-8000-000000000002')
 AND (SELECT state='prepared' FROM public.booking_create_operations WHERE id='bea44000-0000-4000-8000-000000000004')
 AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE facility_id='bea41000-0000-4000-8000-000000000001' AND start_time='11:00'),'notification error rolls back booking and points, leaves replayable receipt');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_receipt_queue_failure ON public.webhook_retry_queue;
SET LOCAL ROLE service_role;
SELECT pg_temp.receipt_create('bea44000-0000-4000-8000-000000000004','11:00');
-- Gate unavailable/disabled or a changed full owner roster cannot publish a
-- partial reservation. Existing committed receipts still replay read-only.
RESET ROLE;
ALTER TABLE public.webhook_retry_queue DISABLE TRIGGER a_guard_webhook_v2_claim;
SET LOCAL ROLE service_role;
SELECT * FROM public.prepare_booking_create_operation('bea44000-0000-4000-8000-000000000005','bea40000-0000-4000-8000-000000000002',NULL,'bea41000-0000-4000-8000-000000000001',repeat('a',64));
DO $$ BEGIN
 BEGIN PERFORM pg_temp.receipt_create('bea44000-0000-4000-8000-000000000005','14:00');RAISE EXCEPTION 'unready dispatch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'WEBHOOK_DISPATCH_V2_UNAVAILABLE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_create(pg_temp.receipt_create('bea44000-0000-4000-8000-000000000001','10:00',NULL)->>'state'='accepted','disabled gate never prevents safe existing receipt replay');
END $$;
RESET ROLE;
ALTER TABLE public.webhook_retry_queue ENABLE TRIGGER a_guard_webhook_v2_claim;
ALTER FUNCTION public.webhook_dispatch_v2_version() RENAME TO synthetic_unavailable_dispatch_version;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.receipt_create('bea44000-0000-4000-8000-000000000005','14:00');RAISE EXCEPTION 'missing dispatch marker accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'WEBHOOK_DISPATCH_V2_UNAVAILABLE' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ALTER FUNCTION public.synthetic_unavailable_dispatch_version() RENAME TO webhook_dispatch_v2_version;
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('bea40000-0000-4000-8000-000000000003','bea41000-0000-4000-8000-000000000001','admin');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.receipt_create('bea44000-0000-4000-8000-000000000005','14:00');RAISE EXCEPTION 'partial owner plan accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_NOTIFICATION_TARGET_CHANGED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_create((SELECT sum(points)=300 FROM public.user_points WHERE user_id='bea40000-0000-4000-8000-000000000002') AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE facility_id='bea41000-0000-4000-8000-000000000001' AND start_time='14:00'),'full-set/gate failures never leave booking or debit');
END $$;
RESET ROLE;
DELETE FROM public.facility_members WHERE user_id='bea40000-0000-4000-8000-000000000003' AND facility_id='bea41000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
-- Changes to displayed/recipient information supersede the frozen envelope.
-- Each inner exception rolls back only that mutation; no notification is sent.
DO $$ DECLARE step int; bid uuid; qid uuid; outcome text;
BEGIN
 SELECT booking_id INTO bid FROM public.booking_create_operations WHERE id='bea44000-0000-4000-8000-000000000004';
 SELECT id INTO qid FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000004' AND webhook_type='email';
 FOR step IN 1..11 LOOP
  BEGIN
   CASE step
    WHEN 1 THEN UPDATE public.bookings SET customer_name='Changed' WHERE id=bid;
    WHEN 2 THEN UPDATE public.bookings SET email='changed@example.invalid' WHERE id=bid;
    WHEN 3 THEN UPDATE public.bookings SET booking_date='2030-01-14' WHERE id=bid;
    WHEN 4 THEN UPDATE public.bookings SET start_time='11:05' WHERE id=bid;
    WHEN 5 THEN UPDATE public.bookings SET end_time='11:35' WHERE id=bid;
    WHEN 6 THEN UPDATE public.bookings SET staff_id=NULL WHERE id=bid;
    WHEN 7 THEN UPDATE public.bookings SET total_price=450 WHERE id=bid;
    WHEN 8 THEN UPDATE public.facility_profiles SET name='Changed' WHERE id='bea41000-0000-4000-8000-000000000001';
    WHEN 9 THEN UPDATE public.facility_menus SET name='Changed' WHERE id='bea42000-0000-4000-8000-000000000001';
    WHEN 10 THEN UPDATE public.staff_profiles SET name='Changed' WHERE id='bea43000-0000-4000-8000-000000000001';
    WHEN 11 THEN UPDATE public.bookings SET status='cancelled' WHERE id=bid;
   END CASE;
   PERFORM pg_temp.claim_receipt(qid);
   SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid,'2030-01-01T00:00Z') x;
   PERFORM pg_temp.assert_create(outcome='superseded' AND (SELECT delivery_started_at IS NULL AND delivered_at IS NULL AND status='failed' FROM public.webhook_retry_queue WHERE id=qid),'changed notification fields never start or pretend accepted');
   RAISE EXCEPTION USING ERRCODE='P0201',MESSAGE='rollback synthetic mutation';
  EXCEPTION WHEN SQLSTATE 'P0201' THEN NULL;
  END;
 END LOOP;
 UPDATE public.bookings SET note='Unrelated internal note' WHERE id=bid;
 PERFORM pg_temp.claim_receipt(qid);
 SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid,'2030-01-01T00:00Z') x;
 PERFORM pg_temp.assert_create(outcome='ready','unrelated note does not suppress an unchanged notification');
END $$;
SELECT pg_temp.claim_receipt((SELECT id FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000001' AND webhook_type='email'));
SELECT pg_temp.assert_create((SELECT outcome='ready' FROM public.start_booking_create_notification((SELECT id FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000001' AND webhook_type='email'),'2030-01-01T00:00Z')),'send fence starts once');
SELECT pg_temp.assert_create((SELECT outcome='not_owned' FROM public.start_booking_create_notification((SELECT id FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000001' AND webhook_type='email'),'2030-01-01T00:00Z')),'started/unknown cannot restart');
DO $$ BEGIN
 BEGIN UPDATE public.webhook_retry_queue SET target_id='wrong@example.invalid' WHERE payload->>'booking_create_operation'='bea44000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'recipient replaced';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN ('BOOKING_CREATE_NOTIFICATION_IMMUTABLE','EVENT_EMAIL_IDENTITY_IMMUTABLE') THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
