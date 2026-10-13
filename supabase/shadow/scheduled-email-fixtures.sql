-- Disposable PG17. No provider invocation; every synthetic record rolls back.
BEGIN;
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_scheduled(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduled fixture failed: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,created_at) VALUES
 ('ce110000-0000-4000-8000-000000000001','scheduled-one@example.invalid',now()),
 ('ce110000-0000-4000-8000-000000000002','scheduled-two@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ce120000-0000-4000-8000-000000000001','Public clinic','scheduled-public','その他','検証県','検証市','検証住所','published'),
 ('ce120000-0000-4000-8000-000000000002','Hidden clinic','scheduled-hidden','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES
 ('ce140000-0000-4000-8000-000000000001','ce120000-0000-4000-8000-000000000001','synthetic','Public menu',500,30,true),
 ('ce140000-0000-4000-8000-000000000002','ce120000-0000-4000-8000-000000000001','synthetic','Private menu',500,30,false),
 ('ce140000-0000-4000-8000-000000000003','ce120000-0000-4000-8000-000000000002','synthetic','Hidden menu',500,30,true);
INSERT INTO public.favorites(user_id,facility_id) VALUES
 ('ce110000-0000-4000-8000-000000000001','ce120000-0000-4000-8000-000000000001'),
 ('ce110000-0000-4000-8000-000000000001','ce120000-0000-4000-8000-000000000002'),
 ('ce110000-0000-4000-8000-000000000002','ce120000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('favorites_digest','ce110000-0000-4000-8000-000000000001','scheduled-one@example.invalid');
 PERFORM pg_temp.assert_scheduled(r.state='legacy_uncertain','cutover week is not replayed from a cleared old marker');
END $$;
RESET ROLE;
-- Simulate the next delivery week in this disposable transaction only.
UPDATE public.scheduled_email_cutover SET installed_at=now()-interval '7 days';
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,updated_at) VALUES
 ('ce130000-0000-4000-8000-000000000001','ce120000-0000-4000-8000-000000000001','ce110000-0000-4000-8000-000000000001','2030-01-07','10:00','11:00','Synthetic one','scheduled-one@example.invalid','completed',0,now()-interval '36 hours'),
 ('ce130000-0000-4000-8000-000000000002','ce120000-0000-4000-8000-000000000001','ce110000-0000-4000-8000-000000000001','2030-01-08','10:00','11:00','Synthetic one','scheduled-one@example.invalid','completed',0,now()-interval '36 hours');
UPDATE public.bookings SET review_request_legacy_claimed_at=now()-interval '12 hours' WHERE id='ce130000-0000-4000-8000-000000000002';
DO $$ DECLARE r record; again record; publication record; fence record; envelope jsonb; operation uuid; snap jsonb;
BEGIN
 BEGIN PERFORM b.review_request_sent_at FROM public.bookings b; RAISE EXCEPTION 'legacy review producer not fenced';
 EXCEPTION WHEN undefined_column THEN NULL; END;
 BEGIN PERFORM p.favorites_digest_sent_week FROM public.profiles p; RAISE EXCEPTION 'legacy digest producer not fenced';
 EXCEPTION WHEN undefined_column THEN NULL; END;
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','ce130000-0000-4000-8000-000000000002',NULL);
 PERFORM pg_temp.assert_scheduled(r.state='legacy_uncertain' AND r.operation_id IS NULL,'legacy claim is NOT provider evidence and cannot resend');
 PERFORM pg_temp.assert_scheduled((public.scheduled_email_legacy_holds()->>'review_request')::int=1,'legacy hold observed');
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','ce130000-0000-4000-8000-000000000001',NULL);
 operation:=r.operation_id; snap:=r.snapshot;
 SELECT * INTO again FROM public.reserve_scheduled_email_atomic('review_request','ce130000-0000-4000-8000-000000000001',NULL);
 PERFORM pg_temp.assert_scheduled(r.state='reserved' AND again.operation_id=operation AND again.snapshot=snap,'stable booking identity and snapshot');
 envelope:=jsonb_build_object('from','a@example.invalid','to',snap->>'email','subject','Synthetic','html','Original content');
 SELECT * INTO publication FROM public.prepare_scheduled_email_atomic(operation,envelope);
 PERFORM pg_temp.assert_scheduled(publication.id=operation AND publication.created AND publication.status='pending','one queue operation published');
 SELECT * INTO publication FROM public.prepare_scheduled_email_atomic(operation,envelope||jsonb_build_object('html','Changed content'));
 PERFORM pg_temp.assert_scheduled(NOT publication.created AND (SELECT email_envelope->>'html'='Original content' FROM public.webhook_retry_queue WHERE id=operation),'later run cannot rewrite envelope');
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_scheduled(fence.outcome='ready' AND fence.started_at IS NOT NULL,'one eligible dispatch starts');
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_scheduled(fence.outcome='not_owned','unknown dispatch is not started again');
 BEGIN UPDATE public.webhook_retry_queue SET status='success',delivered_at=now() WHERE id=operation;
  RAISE EXCEPTION 'missing provider proof accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SCHEDULED_EMAIL_ACCEPTANCE_NOT_CONFIRMED' THEN RAISE; END IF; END;
 UPDATE public.webhook_retry_queue SET status='success',delivered_at=now(),provider_message_id='ce150000-0000-4000-8000-000000000001' WHERE id=operation;
 PERFORM pg_temp.assert_scheduled((SELECT accepted_at IS NOT NULL FROM public.scheduled_email_operations WHERE id=operation)
  AND (SELECT review_request_provider_accepted_at IS NOT NULL FROM public.bookings WHERE id='ce130000-0000-4000-8000-000000000001'),'acceptance and business marker commit together');
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','ce130000-0000-4000-8000-000000000001',NULL);
 PERFORM pg_temp.assert_scheduled(r.state='accepted','accepted receipt survives rerun');
 DELETE FROM public.webhook_retry_queue WHERE id=operation;
 SELECT * INTO publication FROM public.prepare_scheduled_email_atomic(operation,envelope);
 PERFORM pg_temp.assert_scheduled(publication.status='uncertain' AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue WHERE id=operation),'queue deletion never creates another provider call');

 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('favorites_digest','ce110000-0000-4000-8000-000000000001','scheduled-one@example.invalid');
 operation:=r.operation_id;snap:=r.snapshot;
 PERFORM pg_temp.assert_scheduled(jsonb_array_length(snap->'facilities')=1 AND snap->'facilities'->0->>'name'='Public clinic','hidden facility/private menu excluded from content');
 PERFORM pg_temp.assert_scheduled(EXISTS(SELECT 1 FROM public.email_unsubscribe_tokens WHERE token=snap->>'unsubscribeToken' AND user_id='ce110000-0000-4000-8000-000000000001'),'unsubscribe token saved with operation');
 SELECT * INTO again FROM public.reserve_scheduled_email_atomic('favorites_digest','ce110000-0000-4000-8000-000000000001','different@example.invalid');
 PERFORM pg_temp.assert_scheduled(again.operation_id=operation AND again.snapshot=snap,'same user/week retains original email/token/snapshot');
 envelope:=jsonb_build_object('from','a@example.invalid','to',snap->>'email','subject','Synthetic','html','Synthetic');
 PERFORM public.prepare_scheduled_email_atomic(operation,envelope);
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
 UPDATE public.profiles SET email_unsubscribed=true WHERE id='ce110000-0000-4000-8000-000000000001';
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_scheduled(fence.outcome='superseded' AND fence.started_at IS NULL,'current unsubscribe prevents dispatch');

 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('favorites_digest','ce110000-0000-4000-8000-000000000002','scheduled-two@example.invalid');
 operation:=r.operation_id;snap:=r.snapshot;
 envelope:=jsonb_build_object('from','a@example.invalid','to',snap->>'email','subject','Synthetic','html','Synthetic');
 PERFORM public.prepare_scheduled_email_atomic(operation,envelope);
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
 UPDATE public.facility_profiles SET status='draft' WHERE id='ce120000-0000-4000-8000-000000000001';
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_scheduled(fence.outcome='superseded' AND fence.started_at IS NULL,'unpublished after reservation cannot leak through digest');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.assert_scheduled(NOT has_table_privilege('anon','public.scheduled_email_operations','SELECT')
  AND NOT has_table_privilege('authenticated','public.scheduled_email_operations','INSERT')
  AND NOT has_function_privilege('authenticated','public.reserve_scheduled_email_atomic(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.start_scheduled_email_delivery(uuid,timestamptz,boolean)','EXECUTE'),'service-only RLS/ACL');
END $$;
ROLLBACK;
