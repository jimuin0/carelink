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
SELECT pg_temp.assert_channel(NOT has_table_privilege('anon','public.customer_booking_channel_events','SELECT')
 AND NOT has_table_privilege('authenticated','public.customer_booking_channel_operations','INSERT')
 AND NOT has_table_privilege('anon','public.webhook_retry_queue','SELECT')
 AND NOT has_function_privilege('authenticated','public.start_customer_booking_channel(uuid,timestamptz)','EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('publish_customer_booking_channels','start_customer_booking_channel','record_customer_booking_channel_rejection') AND prosecdef),
 'private service-only invoker contract');
CREATE FUNCTION pg_temp.fail_channel_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.payload ? 'customer_booking_channel_version' THEN RAISE EXCEPTION 'SYNTHETIC_CHANNEL_INSERT_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_channel_insert_failure BEFORE INSERT ON public.webhook_retry_queue
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_channel_insert();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.change_customer_booking_with_outbox_receipt_atomic('be130000-0000-4000-8000-000000000001','be110000-0000-4000-8000-000000000001','2030-01-07','12:00','13:00',true);
  PERFORM public.publish_customer_booking_channels('be130000-0000-4000-8000-000000000001','rescheduled');
  RAISE EXCEPTION 'missing channel rollback failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_CHANNEL_INSERT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_channel((SELECT start_time='10:00' FROM public.bookings WHERE id='be130000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.customer_booking_channel_events) AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue),
  'source mutation, email and complete channel plan all roll back together');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_channel_insert_failure ON public.webhook_retry_queue;
SET LOCAL ROLE service_role;
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; fence record; epoch timestamptz:=clock_timestamp(); total integer;
BEGIN
  total:=public.publish_customer_booking_channels('be130000-0000-4000-8000-000000000001','rescheduled');
  PERFORM pg_temp.assert_channel(total=3,'customer push, owner push, ONE shared staff channel planned');
  PERFORM pg_temp.assert_channel((SELECT jsonb_array_length(payload->'recipientStaffIds')=2 FROM public.webhook_retry_queue
    WHERE webhook_type='customer_booking_lineworks'),'complete group recipient proof');
  PERFORM pg_temp.assert_channel(public.publish_customer_booking_channels('be130000-0000-4000-8000-000000000001','rescheduled')=0,'same event never replans');
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_push' AND payload->>'role'='customer';
  BEGIN
    UPDATE public.webhook_retry_queue SET target_id='be170000-0000-4000-8000-000000000002' WHERE id=q.id;
    RAISE EXCEPTION 'missing immutable failure';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CHANNEL_QUEUE_IMMUTABLE' THEN RAISE; END IF; END;
  UPDATE public.webhook_retry_queue SET status='processing',claimed_at=epoch WHERE id=q.id;
  SELECT * INTO fence FROM public.start_customer_booking_channel(q.id,epoch-interval '1 second');
  PERFORM pg_temp.assert_channel(fence.outcome='not_owned','stale owner cannot start');
  SELECT * INTO fence FROM public.start_customer_booking_channel(q.id,epoch);
  PERFORM pg_temp.assert_channel(fence.outcome='ready' AND fence.started_at IS NOT NULL,'current captured endpoint allowed');
  BEGIN
    UPDATE public.webhook_retry_queue SET status='pending',delivery_started_at=NULL WHERE id=q.id;
    RAISE EXCEPTION 'missing start protection';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CHANNEL_REJECTION_RECEIPT_REQUIRED' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.record_customer_booking_channel_rejection(q.id,epoch,fence.started_at,500);
    RAISE EXCEPTION 'missing rejection protection';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_CHANNEL_REJECTION_UNPROVEN' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_channel(public.record_customer_booking_channel_rejection(q.id,epoch,fence.started_at,429)='rescheduled','definite refusal may retry');
  PERFORM pg_temp.assert_channel((SELECT status='pending' AND delivery_started_at IS NULL AND attempt_count=1 FROM public.webhook_retry_queue WHERE id=q.id)
    AND (SELECT count(*)=1 FROM public.customer_booking_channel_rejections WHERE operation_id=q.id),'retry AND receipt atomic');
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_lineworks';
  UPDATE public.webhook_retry_queue SET status='processing',claimed_at=epoch WHERE id=q.id;
  SELECT * INTO fence FROM public.start_customer_booking_channel(q.id,epoch);
  PERFORM pg_temp.assert_channel(fence.outcome='ready','staff group allowed');
  UPDATE public.webhook_retry_queue SET max_attempts=1 WHERE id=q.id;
  PERFORM pg_temp.assert_channel(public.record_customer_booking_channel_rejection(q.id,epoch,fence.started_at,403)='dead-letter','definite refusal capped and visible');
  PERFORM pg_temp.assert_channel((SELECT status='failed' AND delivery_started_at IS NOT NULL FROM public.webhook_retry_queue WHERE id=q.id),'terminal rejection preserves history');
END $$;

-- Endpoint rotation never redirects the saved message to a new endpoint.
UPDATE public.push_subscriptions SET endpoint='https://push.example.invalid/new' WHERE id='be170000-0000-4000-8000-000000000001';
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_push' AND payload->>'role'='customer';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='superseded','rotated endpoint cannot receive old message');
END $$;

-- Permission revoked before send means no provider attempt.
DELETE FROM public.facility_members WHERE user_id='be110000-0000-4000-8000-000000000002';
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_push' AND payload->>'role'='owner';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='superseded','revoked owner cannot receive');
END $$;
DELETE FROM public.webhook_retry_queue WHERE payload ? 'customer_booking_channel_version';
INSERT INTO public.push_subscriptions(id,user_id,endpoint,p256dh,auth)
 VALUES('be170000-0000-4000-8000-000000000003','be110000-0000-4000-8000-000000000003','https://push.example.invalid/late','synthetic-p256dh','synthetic-auth');
SELECT pg_temp.assert_channel(public.publish_customer_booking_channels('be130000-0000-4000-8000-000000000001','rescheduled')=0
 AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE payload ? 'customer_booking_channel_version'),
 'queue deletion and late recipient never reconstruct an old event');

SELECT * FROM public.cancel_customer_booking_with_outbox_atomic('be110000-0000-4000-8000-000000000001','be130000-0000-4000-8000-000000000001','confirmed');
SELECT pg_temp.assert_channel(public.publish_customer_booking_channels('be130000-0000-4000-8000-000000000001','cancelled')=3,
 'cancel plans verified LINE, current admin push, one shared staff channel');
DELETE FROM public.line_user_links WHERE user_id='be110000-0000-4000-8000-000000000001';
INSERT INTO public.line_user_links(user_id,line_user_id,proof_version,verified_at)
 VALUES('be110000-0000-4000-8000-000000000001','U11111111111111111111111111111111',1,clock_timestamp());
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_line';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='superseded','new LINE proof cannot restore the prior consent');
END $$;
SELECT pg_temp.assert_channel(NOT EXISTS(SELECT 1 FROM public.customer_booking_channel_operations
 WHERE to_jsonb(customer_booking_channel_operations)::text LIKE '%push.example%' OR to_jsonb(customer_booking_channel_operations)::text LIKE '%synthetic-auth%'),
 'durable identity retains no endpoint secrets');
INSERT INTO public.facility_notification_settings(facility_id,push_on_cancel)
 VALUES('be120000-0000-4000-8000-000000000001',false);
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_push' AND payload->>'kind'='cancelled';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='superseded','new opt-out row is current at send boundary');
END $$;
UPDATE public.staff_profiles SET line_works_notify_all=false WHERE id='be160000-0000-4000-8000-000000000002';
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_lineworks' AND payload->>'kind'='cancelled';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='ready','one still-authorized captured staff permits shared group');
 PERFORM pg_temp.assert_channel(public.record_customer_booking_channel_rejection(q.id,stamp,f.started_at,401)='rescheduled','known auth refusal is recoverable');
END $$;
UPDATE public.staff_profiles SET line_works_channel_id='synthetic-different' WHERE id='be160000-0000-4000-8000-000000000001';
DO $$ DECLARE q public.webhook_retry_queue%ROWTYPE; f record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_type='customer_booking_lineworks' AND payload->>'kind'='cancelled';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q.id;
 SELECT * INTO f FROM public.start_customer_booking_channel(q.id,stamp);
 PERFORM pg_temp.assert_channel(f.outcome='superseded','rebound channel never receives old private content');
END $$;
ROLLBACK;
