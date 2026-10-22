-- Disposable PG17 only. Rollback every synthetic row; never call a provider.
BEGIN;
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_channel(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking channel fixture failed: %',label; END IF; END $$;
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
RESET ROLE;
INSERT INTO public.push_subscriptions(id,user_id,endpoint,p256dh,auth) VALUES
 ('be170000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','https://push.example.invalid/customer','synthetic-p256dh','synthetic-auth'),
 ('be170000-0000-4000-8000-000000000002','be110000-0000-4000-8000-000000000002','https://push.example.invalid/owner','synthetic-p256dh','synthetic-auth');
UPDATE public.profiles SET line_user_id='U11111111111111111111111111111111' WHERE id='be110000-0000-4000-8000-000000000001';
INSERT INTO public.line_user_links(user_id,line_user_id,proof_version,verified_at)
 VALUES('be110000-0000-4000-8000-000000000001','U11111111111111111111111111111111',1,now());
UPDATE public.staff_profiles SET line_works_channel_id='synthetic-shared' WHERE id='be160000-0000-4000-8000-000000000001';
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active,line_works_channel_id,line_works_notify_all)
 VALUES('be160000-0000-4000-8000-000000000002','be120000-0000-4000-8000-000000000001','Synthetic notify','channel-notify',true,'synthetic-shared',true);

INSERT INTO public.facility_cancel_policies(facility_id,free_cancel_hours,late_cancel_rate)
 VALUES('be120000-0000-4000-8000-000000000001',24,50);
SELECT pg_temp.assert_channel(NOT has_function_privilege('authenticated','public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.change_customer_booking_with_channels_atomic(uuid,uuid,date,time,time,boolean)','EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('cancel_customer_booking_with_channels_atomic','change_customer_booking_with_channels_atomic') AND prosecdef),
 'producer gateways remain private invokers');
CREATE FUNCTION pg_temp.reject_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.payload ? 'customer_booking_channel_version' THEN RAISE EXCEPTION 'SYNTHETIC_PLAN_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_plan_failure BEFORE INSERT ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_channel();
SET LOCAL ROLE service_role;
DO $$ DECLARE balance bigint;
BEGIN
 SELECT sum(points) INTO balance FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001';
 BEGIN
  PERFORM public.cancel_customer_booking_with_channels_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'missing failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_PLAN_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_channel((SELECT status='confirmed' FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001')
  AND (SELECT sum(points)=balance FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM public.customer_booking_channel_events WHERE booking_id='be130000-0000-4000-8000-000000000001'),
  'cancel, points refund, emails and channel plan roll back together');
 BEGIN
  PERFORM public.change_customer_booking_with_channels_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
  RAISE EXCEPTION 'missing failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_PLAN_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_channel((SELECT start_time='10:00' FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001'),'change and every intent roll back together');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_plan_failure ON public.webhook_retry_queue;
-- Simulate a policy edit during channel planning, after email snapshot capture.
CREATE FUNCTION pg_temp.change_policy_during_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payload->>'kind'='cancelled' AND NEW.payload ? 'customer_booking_channel_version' THEN
  UPDATE public.facility_cancel_policies SET late_cancel_rate=0 WHERE facility_id=NEW.facility_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER synthetic_policy_edit AFTER INSERT ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.change_policy_during_plan();
SET LOCAL ROLE service_role;
DO $$ DECLARE receipt record; revision timestamptz; intents integer; balance bigint;
BEGIN
 SELECT * INTO receipt FROM public.change_customer_booking_with_channels_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
 PERFORM pg_temp.assert_channel(receipt.id='be130000-0000-4000-8000-000000000001' AND NOT receipt.replayed,'change confirmed');
 SELECT updated_at INTO revision FROM public.bookings WHERE id=receipt.id;
 SELECT count(*) INTO intents FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001';
 PERFORM pg_temp.assert_channel(intents=5,'customer and shared owner emails plus three complete channel targets');
 SELECT * INTO receipt FROM public.change_customer_booking_with_channels_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
 PERFORM pg_temp.assert_channel(receipt.replayed AND (SELECT updated_at=revision FROM public.bookings WHERE id=receipt.id)
  AND (SELECT count(*)=intents FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001'),'same change never replans, supersedes or creates another provider operation');
 BEGIN
  PERFORM public.change_customer_booking_with_channels_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000003','2030-01-07','12:00','13:00',true);
  RAISE EXCEPTION 'missing ownership failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_FORBIDDEN' THEN RAISE; END IF; END;
 SELECT sum(points) INTO balance FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001';
 SELECT * INTO receipt FROM public.cancel_customer_booking_with_channels_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
 PERFORM pg_temp.assert_channel(receipt.id='be130000-0000-4000-8000-000000000001'
  AND receipt.fee_context->'policy'='{"free_cancel_hours":24,"late_cancel_rate":50,"cancel_rule":null}'::jsonb
  AND receipt.fee_context->>'totalPrice'='5000' AND receipt.fee_context->>'bookingDate'='2030-01-07'
  AND receipt.fee_context->>'startTime'='12:00:00' AND (receipt.fee_context->>'capturedAt')::timestamptz>=revision,
  'cancel returns fee inputs from the committed transaction');
 PERFORM pg_temp.assert_channel((SELECT cancel_fee_context=receipt.fee_context AND updated_at>=revision
  FROM public.bookings WHERE id=receipt.id),'the booking keeps the same fee context for the shop');
 PERFORM pg_temp.assert_channel(NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue q
  WHERE q.facility_id='be120000-0000-4000-8000-000000000001'
    AND q.payload->>'kind'='cancelled' AND q.payload ? 'customer_booking_transition_version'
    AND jsonb_build_object('policy',q.payload->'snapshot'->'cancelPolicy','totalPrice',q.payload->'snapshot'->'totalPrice',
      'bookingDate',q.payload->'snapshot'->'bookingDate','startTime',q.payload->'snapshot'->'startTime',
      'capturedAt',q.payload->'snapshot'->'capturedAt') IS DISTINCT FROM receipt.fee_context),
  'email and API fee context share the exact clock and policy snapshot');
 PERFORM pg_temp.assert_channel((SELECT late_cancel_rate=0 FROM public.facility_cancel_policies
  WHERE facility_id='be120000-0000-4000-8000-000000000001'),'new policy does not replace the captured fee context');
 PERFORM pg_temp.assert_channel((SELECT sum(points)=balance+100 FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001')
  AND (SELECT count(*)=2 FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001' AND payload->>'kind'='cancelled' AND payload ? 'customer_booking_transition_version')
  AND (SELECT count(*)=3 FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001' AND payload->>'kind'='cancelled' AND payload ? 'customer_booking_channel_version'),
  'one refund, complete deduplicated owner email plan, verified LINE, owner push and shared staff channel');
 SELECT count(*) INTO intents FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001';
 BEGIN
  PERFORM public.cancel_customer_booking_with_channels_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'missing status conflict';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_REVISION_CONFLICT' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_channel((SELECT count(*)=intents FROM public.webhook_retry_queue WHERE facility_id='be120000-0000-4000-8000-000000000001')
  AND (SELECT sum(points)=balance+100 FROM public.user_points WHERE user_id='be110000-0000-4000-8000-000000000001'),
  'repeat cancellation never refunds or plans twice');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_policy_edit ON public.webhook_retry_queue;
-- No email recipients: the API still returns a verified fee context.
UPDATE public.profiles SET email='' WHERE id IN ('be110000-0000-4000-8000-000000000002','be110000-0000-4000-8000-000000000003');
DELETE FROM public.facility_cancel_policies WHERE facility_id='be120000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,staff_id,menu_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('be130000-0000-4000-8000-000000000002','be120000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001',
 'be160000-0000-4000-8000-000000000001','be150000-0000-4000-8000-000000000001','2030-01-07','15:00','16:00','Synthetic','', 'confirmed',5000,0);
DO $$ DECLARE receipt record;
BEGIN
 SELECT * INTO receipt FROM public.cancel_customer_booking_with_channels_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000002','confirmed');
 PERFORM pg_temp.assert_channel(receipt.fee_context->'policy'='null'::jsonb
  AND receipt.fee_context->>'startTime'='15:00:00' AND (receipt.fee_context->>'capturedAt')::timestamptz IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE payload ? 'customer_booking_transition_version'
    AND payload->'snapshot'->>'bookingId'=receipt.id::text),'no-email cancellation remains valid without fabricating a policy');
 PERFORM pg_temp.assert_channel((SELECT cancel_fee_context=receipt.fee_context FROM public.bookings WHERE id=receipt.id),
  'the no-email fee context is kept on the booking too');
END $$;
RESET ROLE;
ROLLBACK;
