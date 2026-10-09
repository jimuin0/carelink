-- Requires the final verified LINE binding schema. Synthetic rows only; no provider calls.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN IF to_regprocedure('public.bind_verified_liff_account_atomic(uuid,text)') IS NULL THEN RAISE EXCEPTION 'verified LINE migration required for this fixture'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_create(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking LINE fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('bed30000-0000-4000-8000-000000000001','receipt-owner@example.invalid',now()),
 ('bed30000-0000-4000-8000-000000000002','receipt-actor@example.invalid',now()),
 ('bed30000-0000-4000-8000-000000000003','receipt-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours)
VALUES('bed31000-0000-4000-8000-000000000001','Receipt synthetic','receipt-line-synthetic','その他','検証県','検証市','検証住所','draft',
 '{"mon":{"open":"09:00","close":"17:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('bed30000-0000-4000-8000-000000000001','bed31000-0000-4000-8000-000000000001','owner');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES('bed32000-0000-4000-8000-000000000001','bed31000-0000-4000-8000-000000000001','synthetic','Synthetic',500,30,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active) VALUES('bed33000-0000-4000-8000-000000000001','bed31000-0000-4000-8000-000000000001','Synthetic','receipt-line-staff',true);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) VALUES('bed33000-0000-4000-8000-000000000001',1,'09:00','17:00');
INSERT INTO public.facility_photos(facility_id,photo_url,photo_type) VALUES('bed31000-0000-4000-8000-000000000001','https://example.invalid/receipt.jpg','other');
UPDATE public.facility_profiles SET status='published' WHERE id='bed31000-0000-4000-8000-000000000001';
INSERT INTO public.user_points(user_id,points,reason) VALUES('bed30000-0000-4000-8000-000000000002',500,'Synthetic seed');
UPDATE public.profiles SET email=NULL WHERE id='bed30000-0000-4000-8000-000000000001';
INSERT INTO public.facility_notification_settings(facility_id,push_on_new_booking) VALUES('bed31000-0000-4000-8000-000000000001',false);
CREATE FUNCTION pg_temp.receipt_create(p_id uuid,p_start time DEFAULT '10:00',p_notifications jsonb DEFAULT '[{"kind":"email","role":"customer","target":"proxy@example.invalid","envelope":{"from":"test@example.invalid","to":"proxy@example.invalid","subject":"Synthetic receipt","html":"<p>Synthetic</p>"}}]')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE snap jsonb; plan jsonb; BEGIN
 snap:=jsonb_build_object('customer_name','Synthetic','email','proxy@example.invalid','facility_name','Receipt synthetic','menu_name','Synthetic','staff_name','Synthetic','booking_date','2030-01-07','start_time',to_char(p_start,'HH24:MI'),'end_time',to_char(p_start+interval '30 minutes','HH24:MI'),'total_price',400,'status','confirmed');
 SELECT jsonb_agg(x.value||jsonb_build_object('snapshot',snap,'context',jsonb_build_object('owner_ids',jsonb_build_array('bed30000-0000-4000-8000-000000000001'),'owner_push',false,'works_enabled',false,'line_enabled',EXISTS(SELECT 1 FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='line')))) INTO plan FROM jsonb_array_elements(p_notifications) x;
 plan:=plan||jsonb_build_array(jsonb_build_object('kind','push','role','customer','target','bed30000-0000-4000-8000-000000000002','payload',jsonb_build_object('title','Synthetic','body','Synthetic'),'snapshot',snap));
 RETURN (SELECT response_payload FROM public.create_booking_with_receipt_atomic(p_id,'bed30000-0000-4000-8000-000000000002',NULL,repeat('a',64),
 'bed31000-0000-4000-8000-000000000001','bed33000-0000-4000-8000-000000000001','bed32000-0000-4000-8000-000000000001',NULL,
 '2030-01-07',p_start,p_start+interval '30 minutes','Synthetic','proxy@example.invalid',NULL,NULL,400,100,'confirmed',ARRAY['bed32000-0000-4000-8000-000000000001'::uuid],plan));
END $$;
CREATE FUNCTION pg_temp.claim_receipt(qid uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM * FROM public.claim_webhook_retry_queue_v2(ARRAY[qid],'2030-01-01T00:00Z');
END $$;

INSERT INTO public.line_user_links(line_user_id,user_id) VALUES('Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bed30000-0000-4000-8000-000000000002');
-- Model the historical browser-writable profile pointer; it is not proof.
UPDATE public.profiles SET line_user_id='Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id='bed30000-0000-4000-8000-000000000002';
CREATE FUNCTION pg_temp.line_plan() RETURNS jsonb LANGUAGE sql AS $$ SELECT '[{"kind":"email","role":"customer","target":"proxy@example.invalid","envelope":{"from":"sender@example.invalid","to":"proxy@example.invalid","subject":"Synthetic","html":"<p>Synthetic</p>"}},{"kind":"line","role":"customer","target":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payload":{"message":"Synthetic"}}]'::jsonb $$;
SET LOCAL ROLE service_role;
SELECT * FROM public.prepare_booking_create_operation('bed34000-0000-4000-8000-000000000001','bed30000-0000-4000-8000-000000000002',NULL,'bed31000-0000-4000-8000-000000000001',repeat('a',64));

DO $$ BEGIN
 BEGIN PERFORM pg_temp.receipt_create('bed34000-0000-4000-8000-000000000001','14:00',pg_temp.line_plan());RAISE EXCEPTION 'unverified legacy link accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_NOTIFICATION_TARGET_CHANGED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_create(NOT EXISTS(SELECT 1 FROM public.bookings WHERE facility_id='bed31000-0000-4000-8000-000000000001') AND (SELECT sum(points)=500 FROM public.user_points WHERE user_id='bed30000-0000-4000-8000-000000000002'),'unproven legacy identity rolls back booking/debit');
END $$;
SELECT * FROM public.bind_verified_liff_account_atomic('bed30000-0000-4000-8000-000000000002','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
SELECT pg_temp.assert_create(pg_temp.receipt_create('bed34000-0000-4000-8000-000000000001','14:00',pg_temp.line_plan())->>'state'='accepted','live-proof service binding permits one atomic LINE job');
SELECT pg_temp.assert_create((SELECT count(*)=3 FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bed34000-0000-4000-8000-000000000001'),'one email/push/LINE with same V2 operation');
DO $$ DECLARE qid uuid; outcome text; BEGIN
 SELECT id INTO qid FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='bed34000-0000-4000-8000-000000000001' AND webhook_type='line_push';
 PERFORM pg_temp.claim_receipt(qid);
 SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid,'2030-01-01T00:00Z') x;
 PERFORM pg_temp.assert_create(outcome='ready','owned verified line dispatch crosses fence once');
 SELECT x.outcome INTO outcome FROM public.start_booking_create_notification(qid,'2030-01-01T00:00Z') x;
 PERFORM pg_temp.assert_create(outcome='not_owned','started LINE job never auto-restarts');
END $$;
RESET ROLE;
ROLLBACK;
