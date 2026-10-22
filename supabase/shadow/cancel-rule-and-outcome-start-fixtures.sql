-- Disposable PG17 only. Rollback every synthetic row; never call a provider.
-- 20261023020000: the shop's cancellation rule is enforced on online cancellation and
-- frozen into the emailed fee context, which is also kept on the booking.
-- 20261023020100: 完了 / 無断キャンセル (and checkout that completes) only after the start.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_rule(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'cancel rule / outcome fixture failed: %',label; END IF; END $$;

DO $$ DECLARE sig text; role_name text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.cancel_booking_with_points_atomic(uuid,uuid,text)',
  'public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text)',
  'public.publish_customer_booking_transition_email(uuid,text,date,time,time)',
  'public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid)',
  'public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean)',
  'public.complete_booking_with_points_atomic(uuid,uuid,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_function_privilege(role_name,sig,'EXECUTE') THEN RAISE EXCEPTION 'public booking mutation exposed: %',sig; END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'service gateway lost: %',sig; END IF;
 END LOOP;
END $$;

INSERT INTO auth.users(id,email,created_at) VALUES
 ('cf110000-0000-4000-8000-000000000001','rule-customer@example.invalid',now()),
 ('cf110000-0000-4000-8000-000000000002','rule-owner@example.invalid',now());
UPDATE public.profiles SET email='rule-owner@example.invalid' WHERE id='cf110000-0000-4000-8000-000000000002';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('cf120000-0000-4000-8000-000000000001','Rule clinic','cancel-rule-synthetic','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role)
 VALUES('cf110000-0000-4000-8000-000000000002','cf120000-0000-4000-8000-000000000001','owner');

-- The column accepts only the three rules (NULL = saved before the column existed).
DO $$ BEGIN
 BEGIN INSERT INTO public.facility_cancel_policies(facility_id,free_cancel_hours,late_cancel_rate,cancel_rule)
  VALUES('cf120000-0000-4000-8000-000000000001',0,50,'cancel_never'); RAISE EXCEPTION 'unknown rule accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.facility_cancel_policies(facility_id,free_cancel_hours,late_cancel_rate,cancel_rule)
 VALUES('cf120000-0000-4000-8000-000000000001',24,50,'no_online');

SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used) VALUES
 ('cf130000-0000-4000-8000-000000000001','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  '2030-01-07','10:00','11:00','Synthetic customer','rule-customer@example.invalid','confirmed',5000,0),
 ('cf130000-0000-4000-8000-000000000002','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  '2030-01-07','12:00','13:00','Synthetic customer','rule-customer@example.invalid','confirmed',5000,0);

-- 1. 「ネットでのキャンセル不可」: the online cancellation is refused and nothing is saved or queued.
DO $$ BEGIN
 BEGIN
  PERFORM public.cancel_customer_booking_with_channels_atomic('cf110000-0000-4000-8000-000000000001','cf130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'online cancellation accepted although the shop refuses it';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_ONLINE_CANCEL_DISABLED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_rule((SELECT status='confirmed' AND cancel_fee_context IS NULL FROM public.bookings
  WHERE id='cf130000-0000-4000-8000-000000000001')
  AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE facility_id='cf120000-0000-4000-8000-000000000001'),
  'refused cancellation leaves the booking, emails and channels untouched');
 -- The same refusal from the inner primitive (the outbox gateway of the previous release).
 BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic('cf110000-0000-4000-8000-000000000001','cf130000-0000-4000-8000-000000000001','confirmed');
  RAISE EXCEPTION 'previous gateway bypassed the rule';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_ONLINE_CANCEL_DISABLED' THEN RAISE; END IF; END;
END $$;

-- 2. 「期限なし（常にキャンセル料）」: accepted; the rule is frozen into the email snapshot
--    and the fee context, and the booking keeps that context without a new revision.
RESET ROLE;
UPDATE public.facility_cancel_policies SET cancel_rule='always_fee' WHERE facility_id='cf120000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE receipt record; b public.bookings%ROWTYPE; BEGIN
 SELECT * INTO receipt FROM public.cancel_customer_booking_with_channels_atomic('cf110000-0000-4000-8000-000000000001','cf130000-0000-4000-8000-000000000001','confirmed');
 SELECT * INTO b FROM public.bookings WHERE id=receipt.id;
 PERFORM pg_temp.assert_rule(b.status='cancelled'
  AND receipt.fee_context->'policy'='{"free_cancel_hours":24,"late_cancel_rate":50,"cancel_rule":"always_fee"}'::jsonb
  AND b.cancel_fee_context=receipt.fee_context,'fee context carries the rule and is kept on the booking');
 PERFORM pg_temp.assert_rule((SELECT count(*)=2 FROM public.webhook_retry_queue q
  WHERE q.facility_id=b.facility_id AND q.payload->>'kind'='cancelled' AND q.payload ? 'customer_booking_transition_version'
    AND q.payload->'snapshot'->'cancelPolicy'->>'cancel_rule'='always_fee'
    AND (q.payload->'snapshot'->>'bookingRevision')::timestamptz=b.updated_at
    AND q.payload->'snapshot'->'capturedAt'=b.cancel_fee_context->'capturedAt'),
  'customer and owner emails freeze the same rule, clock and booking revision');
END $$;

-- 3. A row saved before the column (NULL rule, free_cancel_hours=0) is never refused by SQL;
--    the application reads it as 「期限なし」 (src/lib/cancel-fee.ts).
RESET ROLE;
UPDATE public.facility_cancel_policies SET cancel_rule=NULL,free_cancel_hours=0 WHERE facility_id='cf120000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE receipt record; BEGIN
 SELECT * INTO receipt FROM public.cancel_customer_booking_with_channels_atomic('cf110000-0000-4000-8000-000000000001','cf130000-0000-4000-8000-000000000002','confirmed');
 PERFORM pg_temp.assert_rule(receipt.fee_context->'policy'='{"free_cancel_hours":0,"late_cancel_rate":50,"cancel_rule":null}'::jsonb
  AND (SELECT status='cancelled' FROM public.bookings WHERE id=receipt.id),'legacy row cancels with its policy frozen');
END $$;

-- 4. Visit outcomes only once the booking has started (JST).
RESET ROLE;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used) VALUES
 ('cf130000-0000-4000-8000-000000000011','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  '2030-01-07','15:00','16:00','Synthetic future',NULL,'confirmed',3000,0),
 ('cf130000-0000-4000-8000-000000000012','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  '2020-01-06','15:00','16:00','Synthetic past',NULL,'confirmed',3000,0);
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 SELECT 'cf130000-0000-4000-8000-000000000013','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  (t - interval '10 minutes')::date,(t - interval '10 minutes')::time,(t + interval '50 minutes')::time,'Synthetic just started',NULL,'confirmed',3000,0
 FROM (SELECT clock_timestamp() AT TIME ZONE 'Asia/Tokyo' AS t) now_jst;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 SELECT 'cf130000-0000-4000-8000-000000000014','cf120000-0000-4000-8000-000000000001','cf110000-0000-4000-8000-000000000001',
  (t + interval '10 minutes')::date,(t + interval '10 minutes')::time,(t + interval '70 minutes')::time,'Synthetic starts soon',NULL,'confirmed',3000,0
 FROM (SELECT clock_timestamp() AT TIME ZONE 'Asia/Tokyo' AS t) now_jst;
CREATE FUNCTION pg_temp.set_status(booking uuid,next_status text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.save_booking_email_event_atomic('cf110000-0000-4000-8000-000000000002',booking,
  (SELECT status FROM public.bookings WHERE id=booking),(SELECT updated_at FROM public.bookings WHERE id=booking),next_status,NULL);
 RETURN 'saved';
EXCEPTION WHEN raise_exception THEN RETURN SQLERRM;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE target text; future uuid:='cf130000-0000-4000-8000-000000000011'; BEGIN
 FOREACH target IN ARRAY ARRAY['completed','no_show'] LOOP
  PERFORM pg_temp.assert_rule(pg_temp.set_status(future,target)='BOOKING_NOT_STARTED','future booking refuses '||target);
 END LOOP;
 PERFORM pg_temp.assert_rule(pg_temp.set_status('cf130000-0000-4000-8000-000000000014','completed')='BOOKING_NOT_STARTED',
  'ten minutes before the start is still refused');
 BEGIN PERFORM public.complete_booking_with_points_atomic('cf110000-0000-4000-8000-000000000002',future,'confirmed');
  RAISE EXCEPTION 'future completion accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_NOT_STARTED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.checkout_booking_with_points_atomic('cf110000-0000-4000-8000-000000000002',future,'confirmed',
   (SELECT updated_at FROM public.bookings WHERE id=future),'[{"type":"menu","name":"Synthetic","amount":3000}]',3000,true);
  RAISE EXCEPTION 'future checkout completion accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_NOT_STARTED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_rule((SELECT status='confirmed' AND charges IS NULL FROM public.bookings WHERE id=future)
  AND NOT EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=future)
  AND NOT EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id=future),'refused outcomes award no points and record no visit');
 -- Recording charges without completing, 受付 and the shop's cancellation stay available.
 PERFORM public.checkout_booking_with_points_atomic('cf110000-0000-4000-8000-000000000002',future,'confirmed',
   (SELECT updated_at FROM public.bookings WHERE id=future),'[{"type":"menu","name":"Synthetic","amount":3200}]',NULL,false);
 PERFORM pg_temp.assert_rule((SELECT status='confirmed' AND total_price=3200 FROM public.bookings WHERE id=future),'checkout without completion is saved');
 PERFORM pg_temp.assert_rule(pg_temp.set_status(future,'arrived')='saved','arrival before the start is allowed');
 PERFORM pg_temp.assert_rule(pg_temp.set_status(future,'completed')='BOOKING_NOT_STARTED','arrived future booking still cannot complete');
 PERFORM pg_temp.assert_rule(pg_temp.set_status(future,'cancelled')='saved','the shop can still cancel a future booking');
 -- Started bookings record outcomes as before.
 PERFORM pg_temp.assert_rule(pg_temp.set_status('cf130000-0000-4000-8000-000000000012','completed')='saved','past booking completes');
 PERFORM pg_temp.assert_rule(pg_temp.set_status('cf130000-0000-4000-8000-000000000012','no_show')='saved','completion correction to no_show after the start');
 PERFORM pg_temp.assert_rule((SELECT NOT replayed FROM public.complete_booking_with_points_atomic(
  'cf110000-0000-4000-8000-000000000002','cf130000-0000-4000-8000-000000000013','confirmed')),'a booking that started ten minutes ago completes');
 PERFORM pg_temp.assert_rule((SELECT status='completed' FROM public.bookings WHERE id='cf130000-0000-4000-8000-000000000013'),
  'the started booking is saved as completed');
 PERFORM pg_temp.assert_rule((SELECT replayed FROM public.complete_booking_with_points_atomic(
  'cf110000-0000-4000-8000-000000000002','cf130000-0000-4000-8000-000000000013','confirmed')),'completed replay is unchanged');
END $$;
RESET ROLE;
ROLLBACK;
