-- Isolated PG17 fixture. No provider call and no retained fixture rows.
BEGIN;
CREATE FUNCTION pg_temp.assert_coupon(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon fixture failed: %',label; END IF; END $$;
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours)
VALUES('f8600000-0000-4000-8000-000000000001','Synthetic coupon facility','coupon-fixture','その他',
  '検証県','検証市','検証住所','published','{"mon":{"open":"09:00","close":"18:00"}}');
SELECT pg_temp.assert_coupon(NOT has_table_privilege('anon','public.customer_coupon_email_operations','SELECT'),'operations private');
SELECT pg_temp.assert_coupon(NOT has_table_privilege('authenticated','public.customer_coupon_email_operations','INSERT'),'no member operation creation');
SELECT pg_temp.assert_coupon(NOT has_function_privilege('anon','public.reserve_customer_coupon_email_atomic(uuid,text,date)','EXECUTE'),'no anonymous reservation');
SELECT pg_temp.assert_coupon(NOT has_function_privilege('authenticated','public.prepare_customer_coupon_email_atomic(uuid,jsonb)','EXECUTE'),'no member preparation');
SET LOCAL ROLE service_role;
DO $$ DECLARE a record;b record;j record;BEGIN
 SELECT * INTO a FROM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001',
  'new@example.com',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
 SELECT * INTO b FROM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001',
  'new@example.com',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
 PERFORM pg_temp.assert_coupon(a.state='reserved' AND a.coupon_id=b.coupon_id AND a.operation_id=b.operation_id,'same coupon/operation on replay');
 PERFORM pg_temp.assert_coupon((SELECT count(*)=1 FROM public.user_coupon_codes WHERE email='new@example.com'),'one coupon');
 SELECT * INTO j FROM public.prepare_customer_coupon_email_atomic(a.operation_id,
  '{"from":"CareLink <noreply@carelink-jp.com>","to":"new@example.com","subject":"Synthetic coupon","html":"original immutable envelope"}');
 PERFORM pg_temp.assert_coupon(j.id=a.operation_id AND j.status='pending','published queue');
 SELECT * INTO j FROM public.prepare_customer_coupon_email_atomic(a.operation_id,
  '{"from":"CareLink <noreply@carelink-jp.com>","to":"new@example.com","subject":"Different next-week subject","html":"changed"}');
 PERFORM pg_temp.assert_coupon((SELECT email_envelope->>'html'='original immutable envelope' FROM public.webhook_retry_queue WHERE id=a.operation_id),'envelope unchanged on later cron');
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=now(),delivery_started_at=now() WHERE id=a.operation_id;
 SELECT * INTO j FROM public.prepare_customer_coupon_email_atomic(a.operation_id,'{}');
 PERFORM pg_temp.assert_coupon(j.status='uncertain','started operation not republished/reclaimed');
 UPDATE public.webhook_retry_queue SET status='success',provider_message_id='f8640000-0000-4000-8000-000000000001',
  delivered_at=now(),processed_at=now() WHERE id=a.operation_id;
 PERFORM pg_temp.assert_coupon((SELECT provider_accepted_at IS NOT NULL FROM public.user_coupon_codes WHERE id=a.coupon_id),'marker same acceptance commit');
 SELECT * INTO b FROM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001',
  'new@example.com',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
 PERFORM pg_temp.assert_coupon(b.state='already_notified','no operation minted after acceptance');
END $$;
INSERT INTO public.user_coupon_codes(facility_id,email,code,discount_type,discount_value,reason,valid_until)
VALUES('f8600000-0000-4000-8000-000000000001','legacy@example.com','SYNTHETIC_LEGACY',
  'fixed',500,'at_risk',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
DO $$ DECLARE r record;BEGIN
 SELECT * INTO r FROM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001',
  'legacy@example.com',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
 PERFORM pg_temp.assert_coupon(r.state='legacy_uncertain' AND r.operation_id IS NULL,'legacy marker cannot prove no prior acceptance');
 PERFORM pg_temp.assert_coupon((SELECT count(*)=1 FROM public.customer_coupon_email_operations),'legacy untouched');
 BEGIN
  PERFORM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001','not-an-email',current_date);
  RAISE EXCEPTION 'invalid input unexpectedly accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'COUPON_EMAIL_INVALID_INPUT' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_coupon_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('carelink.fixture_coupon_fail',true)='yes' THEN RAISE EXCEPTION 'synthetic marker failure'; END IF;RETURN NEW;END $$;
CREATE TRIGGER synthetic_marker_failure BEFORE UPDATE ON public.user_coupon_codes FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_coupon_marker();
SET LOCAL ROLE service_role;
DO $$ DECLARE a record;BEGIN
 SELECT * INTO a FROM public.reserve_customer_coupon_email_atomic('f8600000-0000-4000-8000-000000000001',
  'failure@example.com',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
 PERFORM public.prepare_customer_coupon_email_atomic(a.operation_id,
  '{"from":"CareLink <noreply@carelink-jp.com>","to":"failure@example.com","subject":"Synthetic failure","html":"immutable"}');
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at=now(),delivery_started_at=now() WHERE id=a.operation_id;
 PERFORM set_config('carelink.fixture_coupon_fail','yes',true);
 BEGIN
  UPDATE public.webhook_retry_queue SET status='success',provider_message_id='f8640000-0000-4000-8000-000000000002',
    delivered_at=now(),processed_at=now() WHERE id=a.operation_id;
  RAISE EXCEPTION 'marker failure unexpectedly committed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'synthetic marker failure' THEN RAISE; END IF;
 END;
 PERFORM set_config('carelink.fixture_coupon_fail','no',true);
 PERFORM pg_temp.assert_coupon((SELECT status='processing' AND delivery_started_at IS NOT NULL AND provider_message_id IS NULL
   FROM public.webhook_retry_queue WHERE id=a.operation_id),'failed marker retains persistent no-resend fence');
 PERFORM pg_temp.assert_coupon((SELECT provider_accepted_at IS NULL FROM public.user_coupon_codes WHERE id=a.coupon_id),'marker rollback');
 -- Provider lookup reconciliation can commit the same operation, without a send.
 UPDATE public.webhook_retry_queue SET status='success',provider_message_id='f8640000-0000-4000-8000-000000000002',
   delivered_at=now(),processed_at=now() WHERE id=a.operation_id;
 PERFORM pg_temp.assert_coupon((SELECT provider_accepted_at IS NOT NULL FROM public.user_coupon_codes WHERE id=a.coupon_id),'same operation reconciliation recovers marker');
END $$;
RESET ROLE;
ROLLBACK;
