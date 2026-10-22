-- Disposable PG17 only. Rollback every synthetic row; never call a provider.
BEGIN;
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_transition(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'customer transition fixture failed: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,created_at) VALUES
 ('be110000-0000-4000-8000-000000000001','transition-customer@example.invalid',now()),
 ('be110000-0000-4000-8000-000000000002','transition-owner@example.invalid',now()),
 ('be110000-0000-4000-8000-000000000003','transition-other@example.invalid',now());
UPDATE public.profiles SET email='transition-owner@example.invalid'
 WHERE id IN ('be110000-0000-4000-8000-000000000002','be110000-0000-4000-8000-000000000003');
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('be120000-0000-4000-8000-000000000001','Original clinic','transition-synthetic','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('be110000-0000-4000-8000-000000000002','be120000-0000-4000-8000-000000000001','owner'),
 ('be110000-0000-4000-8000-000000000003','be120000-0000-4000-8000-000000000001','admin');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
 VALUES('be150000-0000-4000-8000-000000000001','be120000-0000-4000-8000-000000000001','synthetic','Original menu',5000,60,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active)
 VALUES('be160000-0000-4000-8000-000000000001','be120000-0000-4000-8000-000000000001','Synthetic','transition-staff',true);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time)
 VALUES('be160000-0000-4000-8000-000000000001',1,'09:00','17:00');
INSERT INTO public.facility_photos(facility_id,photo_url,photo_type)
 VALUES('be120000-0000-4000-8000-000000000001','https://example.invalid/transition.jpg','other');
UPDATE public.facility_profiles SET status='published',business_hours='{"mon":{"open":"09:00","close":"17:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id='be120000-0000-4000-8000-000000000001';
INSERT INTO public.user_points(user_id,points,reason) VALUES('be110000-0000-4000-8000-000000000001',500,'Synthetic seed');
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,staff_id,menu_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('be130000-0000-4000-8000-000000000001','be120000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001',
 'be160000-0000-4000-8000-000000000001','be150000-0000-4000-8000-000000000001','2030-01-07','10:00','11:00','Synthetic customer',
 'transition-customer@example.invalid','confirmed',5000,100);
CREATE FUNCTION pg_temp.fail_transition_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.payload ? 'customer_booking_transition_version' THEN RAISE EXCEPTION 'SYNTHETIC_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$;
RESET ROLE;
CREATE TRIGGER synthetic_transition_queue_failure BEFORE INSERT ON public.webhook_retry_queue
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_transition_queue();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'missing queue failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_OUTBOX_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_transition((SELECT status='confirmed' FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.user_points WHERE booking_id='be130000-0000-4000-8000-000000000001' AND booking_operation='refund'),
  'failed notification commit rolls back cancellation AND points refund');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_transition_queue_failure ON public.webhook_retry_queue;
SET LOCAL ROLE service_role;
DO $$ DECLARE revision timestamptz; q public.webhook_retry_queue%ROWTYPE; fence record; receipt record;
BEGIN
 BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic('be110000-0000-4000-8000-000000000003','be130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'wrong actor accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_PERMISSION_DENIED' THEN RAISE; END IF; END;
 SELECT * INTO receipt FROM public.change_customer_booking_with_outbox_receipt_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
 PERFORM pg_temp.assert_transition(receipt.id='be130000-0000-4000-8000-000000000001' AND receipt.replayed=false,'first change has an authoritative changed receipt');
 SELECT updated_at INTO revision FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001';
 PERFORM pg_temp.assert_transition((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE payload->>'customer_booking_transition_version'='1'
  AND payload->>'kind'='rescheduled' AND payload->>'role'='customer'),'one customer change email committed');
 -- Regression: the shop was not told about a customer change. The shared owner/admin address gets one email
 -- with the previous and the new date/time captured in the same transaction.
 PERFORM pg_temp.assert_transition((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE payload->>'customer_booking_transition_version'='1'
  AND payload->>'kind'='rescheduled' AND payload->>'role'='owner' AND target_id='transition-owner@example.invalid'
  AND payload->'snapshot'->'previous'='{"bookingDate":"2030-01-07","startTime":"10:00:00","endTime":"11:00:00"}'::jsonb
  AND payload->'snapshot'->>'startTime'='12:00:00' AND payload->'snapshot'->>'endTime'='13:00:00'),
  'one owner change email with the previous and new date/time committed');
 SELECT * INTO receipt FROM public.change_customer_booking_with_outbox_receipt_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
 PERFORM pg_temp.assert_transition(receipt.replayed=true,'repeated time has an authoritative replay receipt');
 PERFORM pg_temp.assert_transition((SELECT updated_at=revision FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001')
  AND (SELECT count(*)=2 FROM public.webhook_retry_queue WHERE payload->>'customer_booking_transition_version'='1'),'same-request replay neither resends nor changes revision');
 PERFORM public.change_customer_booking_with_outbox_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','14:00','15:00',true);
 PERFORM pg_temp.assert_transition((SELECT count(*)=4 FROM public.webhook_retry_queue WHERE payload->>'customer_booking_transition_version'='1'),
  'two actual transitions in one transaction have distinct identities (customer and owner each)');
 PERFORM pg_temp.assert_transition((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE payload->>'kind'='rescheduled' AND payload->>'role'='owner'
  AND payload->'snapshot'->'previous'->>'startTime'='12:00:00' AND payload->'snapshot'->>'startTime'='14:00:00'),
  'the second change reports the first change as its previous time');
 PERFORM public.cancel_customer_booking_with_outbox_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
 PERFORM pg_temp.assert_transition((SELECT count(*)=2 FROM public.webhook_retry_queue WHERE payload->>'kind'='cancelled'
  AND payload->>'customer_booking_transition_version'='1'),'customer and shared owner/admin address each get one cancellation operation');
 PERFORM pg_temp.assert_transition((SELECT sum(points)=500 FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001'),
  'refund remains atomic with cancellation and notification');
 -- Snapshot is not rebuilt from a renamed shop/menu or a changed policy.
 UPDATE public.facility_profiles SET name='Changed clinic' WHERE id='be120000-0000-4000-8000-000000000001';
 UPDATE public.facility_menus SET name='Changed menu' WHERE id='be150000-0000-4000-8000-000000000001';
 PERFORM pg_temp.assert_transition(NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE payload->>'customer_booking_transition_version'='1'
  AND (payload->'snapshot'->>'facilityName'<>'Original clinic' OR payload->'snapshot'->>'menuName'<>'Original menu')),'immutable original content');
 -- Claim, freeze, fence. Older reschedule is superseded by the cancellation.
 SELECT * INTO q FROM public.webhook_retry_queue WHERE payload->>'kind'='rescheduled' ORDER BY created_at,id LIMIT 1;
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[q.id],now());
 UPDATE public.webhook_retry_queue SET email_envelope=jsonb_build_object('from','a@example.invalid','to',q.target_id,'subject','Synthetic','html','Synthetic') WHERE id=q.id;
 SELECT * INTO fence FROM public.start_customer_booking_transition_email(q.id,now());
 PERFORM pg_temp.assert_transition(fence.outcome='superseded' AND fence.started_at IS NULL,'old change cannot dispatch after cancellation');
 SELECT * INTO q FROM public.webhook_retry_queue WHERE payload->>'kind'='cancelled' AND payload->>'role'='customer';
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[q.id],now());
 UPDATE public.webhook_retry_queue SET email_envelope=jsonb_build_object('from','a@example.invalid','to',q.target_id,'subject','Synthetic','html','Synthetic') WHERE id=q.id;
 SELECT * INTO fence FROM public.start_customer_booking_transition_email(q.id,now());
 PERFORM pg_temp.assert_transition(fence.outcome='ready' AND fence.started_at IS NOT NULL,'one current cancellation starts');
 SELECT * INTO fence FROM public.start_customer_booking_transition_email(q.id,now());
 PERFORM pg_temp.assert_transition(fence.outcome='not_owned','uncertain started operation cannot start a second time');
 SELECT * INTO q FROM public.webhook_retry_queue WHERE payload->>'kind'='cancelled' AND payload->>'role'='owner';
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[q.id],now());
 UPDATE public.webhook_retry_queue SET email_envelope=jsonb_build_object('from','a@example.invalid','to',q.target_id,'subject','Synthetic','html','Synthetic') WHERE id=q.id;
 DELETE FROM public.facility_members WHERE facility_id='be120000-0000-4000-8000-000000000001';
 SELECT * INTO fence FROM public.start_customer_booking_transition_email(q.id,now());
 PERFORM pg_temp.assert_transition(fence.outcome='superseded','revoked owners cannot receive captured private customer details');
END $$;
RESET ROLE;
-- The owner change email starts under the same owner fence as a cancellation email.
-- Removing the last owner above suspended the listing; restore an owner and the listing.
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('be110000-0000-4000-8000-000000000002','be120000-0000-4000-8000-000000000001','owner');
UPDATE public.facility_profiles SET status='published' WHERE id='be120000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,staff_id,menu_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('be130000-0000-4000-8000-000000000002','be120000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001',
 'be160000-0000-4000-8000-000000000001','be150000-0000-4000-8000-000000000001','2030-01-07','15:00','16:00','Synthetic customer',
 'transition-customer@example.invalid','confirmed',5000,0),
 ('be130000-0000-4000-8000-000000000003','be120000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001',
 'be160000-0000-4000-8000-000000000001','be150000-0000-4000-8000-000000000001','2020-01-06','10:00','11:00','Synthetic customer',
 'transition-customer@example.invalid','confirmed',5000,0);
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; fence record; queued integer;
BEGIN
 PERFORM public.change_customer_booking_with_outbox_receipt_atomic('be130000-0000-4000-8000-000000000002','be110000-0000-4000-8000-000000000001','2030-01-07','16:00','17:00',true);
 SELECT * INTO q FROM public.webhook_retry_queue WHERE payload->>'kind'='rescheduled' AND payload->>'role'='owner'
  AND payload->'snapshot'->>'bookingId'='be130000-0000-4000-8000-000000000002';
 PERFORM pg_temp.assert_transition(q.target_id='transition-owner@example.invalid'
  AND q.payload->'snapshot'->'previous'='{"bookingDate":"2030-01-07","startTime":"15:00:00","endTime":"16:00:00"}'::jsonb,
  'owner change email carries the previous time');
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[q.id],now());
 UPDATE public.webhook_retry_queue SET email_envelope=jsonb_build_object('from','a@example.invalid','to',q.target_id,'subject','Synthetic','html','Synthetic') WHERE id=q.id;
 SELECT * INTO fence FROM public.start_customer_booking_transition_email(q.id,now());
 PERFORM pg_temp.assert_transition(fence.outcome='ready' AND fence.started_at IS NOT NULL,'a current owner change email starts');
 -- Regression: a reservation whose start time has passed was moved by the customer.
 SELECT count(*) INTO queued FROM public.webhook_retry_queue;
 BEGIN
  PERFORM public.change_customer_booking_with_outbox_receipt_atomic('be130000-0000-4000-8000-000000000003','be110000-0000-4000-8000-000000000001','2030-01-07','09:00','10:00',true);
  RAISE EXCEPTION 'started reservation changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_ALREADY_STARTED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_transition((SELECT booking_date='2020-01-06' AND start_time='10:00' FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000003')
  AND (SELECT count(*)=queued FROM public.webhook_retry_queue),'a started reservation is neither moved nor notified');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.assert_transition(NOT has_function_privilege('anon','public.publish_customer_booking_transition_email(uuid,text,date,time,time)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.publish_customer_booking_transition_email(uuid,text,date,time,time)','EXECUTE')
  AND has_function_privilege('service_role','public.publish_customer_booking_transition_email(uuid,text,date,time,time)','EXECUTE'),
  'the change publisher stays service-only');
 BEGIN
  PERFORM public.publish_customer_booking_transition_email('be130000-0000-4000-8000-000000000002','cancelled','2030-01-07','15:00','16:00');
  RAISE EXCEPTION 'cancellation with a previous time accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_NOTIFICATION_INVALID' THEN RAISE; END IF; END;
END $$;
DO $$ BEGIN
 PERFORM pg_temp.assert_transition(NOT has_function_privilege('anon','public.cancel_customer_booking_with_outbox_atomic(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.change_customer_booking_with_outbox_atomic(uuid,uuid,date,time,time,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.start_customer_booking_transition_email(uuid,timestamptz)','EXECUTE'),
  'only trusted service gateways may mutate or dispatch');
END $$;
ROLLBACK;
