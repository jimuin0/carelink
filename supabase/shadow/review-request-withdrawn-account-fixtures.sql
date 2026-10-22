-- Disposable PG17. 退会した会員・配信停止したアドレスへ口コミ依頼を送らない（2026年10月23日）。
-- No provider invocation; every synthetic record rolls back.
--
-- 回帰の中身: 退会すると bookings.user_id が NULL になり、口コミ依頼の 3 つの判定（候補一覧・予約確保・
-- 送信直前のフェンス）がその予約を「ゲスト予約＝配信停止の確認なし」と扱っていた。
-- 退会前に配信停止していた会員にも、退会後の次の run で口コミ依頼が届いていた。
-- 20261023050000 より前の定義では、下の「退会後」の assert が候補 1 件・'reserved' になって落ちる。
BEGIN;
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_withdrawn(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'withdrawn review fixture failed: %',label; END IF; END $$;
SELECT pg_temp.assert_withdrawn(NOT has_function_privilege('anon','public.email_address_opted_out(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.email_address_opted_out(text)','EXECUTE')
  AND has_function_privilege('service_role','public.email_address_opted_out(text)','EXECUTE'),'address opt-out check is service-only');
SELECT pg_temp.assert_withdrawn(NOT has_column_privilege('authenticated','public.bookings','account_deleted_at','UPDATE')
  AND NOT has_column_privilege('anon','public.bookings','account_deleted_at','UPDATE'),'browser roles cannot write the retirement marker');

-- 会員 A＝配信停止して退会 / 会員 B＝配信を受け取る設定で退会 / ゲスト G・G2＝ずっとゲスト /
-- ゲスト H＝配信停止リンクで全メール停止にしたアドレス
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('cf210000-0000-4000-8000-00000000000a','withdrawn-a@example.invalid',now()),
 ('cf210000-0000-4000-8000-00000000000b','withdrawn-b@example.invalid',now());
UPDATE public.profiles SET email_unsubscribed=true WHERE id='cf210000-0000-4000-8000-00000000000a';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('cf220000-0000-4000-8000-000000000001','Withdrawn review clinic','withdrawn-review-clinic','その他','検証県','検証市','検証住所','published');
INSERT INTO public.newsletter_subscriptions(email,subscription_type,is_active,unsubscribed_at,source) VALUES
 ('opted-out-guest@example.invalid','all',false,now(),'unsubscribe');
-- 予約の作成時刻を cutover より後にする（既存の scheduled-email-fixtures.sql と同じ手順）。
UPDATE public.scheduled_email_cutover SET installed_at=now()-interval '7 days';
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,updated_at) VALUES
 ('cf230000-0000-4000-8000-00000000000a','cf220000-0000-4000-8000-000000000001','cf210000-0000-4000-8000-00000000000a','2030-02-01','10:00','11:00','Synthetic A','withdrawn-a@example.invalid','completed',0,now()-interval '36 hours'),
 ('cf230000-0000-4000-8000-00000000000b','cf220000-0000-4000-8000-000000000001','cf210000-0000-4000-8000-00000000000b','2030-02-01','11:00','12:00','Synthetic B','withdrawn-b@example.invalid','completed',0,now()-interval '36 hours'),
 ('cf230000-0000-4000-8000-000000000001','cf220000-0000-4000-8000-000000000001',NULL,'2030-02-01','12:00','13:00','Synthetic guest','guest@example.invalid','completed',0,now()-interval '36 hours'),
 ('cf230000-0000-4000-8000-000000000002','cf220000-0000-4000-8000-000000000001',NULL,'2030-02-01','13:00','14:00','Synthetic guest 2','guest-two@example.invalid','completed',0,now()-interval '36 hours'),
 ('cf230000-0000-4000-8000-000000000003','cf220000-0000-4000-8000-000000000001',NULL,'2030-02-01','14:00','15:00','Synthetic opted out','Opted-Out-Guest@example.invalid ','completed',0,now()-interval '36 hours');

SET LOCAL ROLE service_role;
DO $$ DECLARE ids uuid[]; BEGIN
 SELECT array_agg(r.id ORDER BY r.id) INTO ids FROM public.list_scheduled_review_recipients(NULL,NULL,1000) r
  WHERE r.id::text LIKE 'cf230000-%';
 PERFORM pg_temp.assert_withdrawn(ids=ARRAY['cf230000-0000-4000-8000-000000000001','cf230000-0000-4000-8000-000000000002','cf230000-0000-4000-8000-00000000000b']::uuid[],
  'before retirement: guests and the subscribed member are candidates; the unsubscribed member and the opted-out address (case/space-insensitive) are not');
 PERFORM pg_temp.assert_withdrawn((SELECT state FROM public.reserve_scheduled_email_atomic('review_request','cf230000-0000-4000-8000-000000000003',NULL))='not_eligible',
  'reserve refuses an address that stopped all mail');
END $$;
-- B の口コミ依頼は退会前に積まれていた（送信は webhook-retry が後で行う）。
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','cf230000-0000-4000-8000-00000000000b',NULL);
 PERFORM pg_temp.assert_withdrawn(r.state='reserved','member B reserved while still a member');
 PERFORM public.prepare_scheduled_email_atomic(r.operation_id,jsonb_build_object('from','a@example.invalid','to',r.snapshot->>'email','subject','Synthetic','html','Synthetic'));
END $$;
RESET ROLE;

-- 退会（Auth の削除。実環境と同じく auth.users の BEFORE DELETE トリガで後始末が走る）。
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') AND pg_has_role(current_user,'supabase_auth_admin','MEMBER') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; END IF; END $$;
DELETE FROM auth.users WHERE id IN ('cf210000-0000-4000-8000-00000000000a','cf210000-0000-4000-8000-00000000000b');
RESET ROLE;
SELECT pg_temp.assert_withdrawn((SELECT bool_and(user_id IS NULL AND account_deleted_at IS NOT NULL AND email IS NOT NULL) FROM public.bookings
  WHERE id IN ('cf230000-0000-4000-8000-00000000000a','cf230000-0000-4000-8000-00000000000b')),'retirement detaches the booking and records the retirement in the same transaction');
SELECT pg_temp.assert_withdrawn((SELECT bool_and(account_deleted_at IS NULL) FROM public.bookings
  WHERE id IN ('cf230000-0000-4000-8000-000000000001','cf230000-0000-4000-8000-000000000002')),'guest bookings are not marked');
SELECT pg_temp.assert_withdrawn((SELECT bool_and(updated_at=now()-interval '36 hours') FROM public.bookings
  WHERE id IN ('cf230000-0000-4000-8000-00000000000a','cf230000-0000-4000-8000-00000000000b')),'marker does not touch the booking revision (completion time window unchanged)');

SET LOCAL ROLE service_role;
DO $$ DECLARE ids uuid[]; r record; operation uuid; fence record; BEGIN
 -- ケース A（指摘の中心）: 配信停止していた会員が退会しても、次の run の候補にも予約確保にも出ない。
 SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM public.list_scheduled_review_recipients(NULL,NULL,1000) x
  WHERE x.id::text LIKE 'cf230000-%';
 PERFORM pg_temp.assert_withdrawn(ids=ARRAY['cf230000-0000-4000-8000-000000000001','cf230000-0000-4000-8000-000000000002']::uuid[],
  'after retirement: only the genuine guests remain candidates');
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','cf230000-0000-4000-8000-00000000000a',NULL);
 PERFORM pg_temp.assert_withdrawn(r.state='not_eligible' AND r.operation_id IS NULL,'retired unsubscribed member A cannot be reserved as a guest');
 PERFORM pg_temp.assert_withdrawn(NOT EXISTS(SELECT 1 FROM public.scheduled_email_operations WHERE source_id='cf230000-0000-4000-8000-00000000000a'),'no operation row for A');

 -- ケース B: 退会前に積まれていたジョブは送信直前のフェンスで止まる。
 SELECT o.id INTO operation FROM public.scheduled_email_operations o WHERE o.source_id='cf230000-0000-4000-8000-00000000000b';
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_withdrawn(fence.outcome='superseded' AND fence.started_at IS NULL,'queued job of retired member B does not start');

 -- 正の対照: ずっとゲストの予約はこれまでどおり送られる。
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','cf230000-0000-4000-8000-000000000001',NULL);
 operation:=r.operation_id;
 PERFORM pg_temp.assert_withdrawn(r.state='reserved','genuine guest booking is still reserved');
 PERFORM public.prepare_scheduled_email_atomic(operation,jsonb_build_object('from','a@example.invalid','to',r.snapshot->>'email','subject','Synthetic','html','Synthetic'));
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_withdrawn(fence.outcome='ready','genuine guest delivery still starts');

 -- フェンス単体: 予約確保の後に印が付いた（＝旧アプリが退会後に確保した）ジョブも止まる。
 SELECT * INTO r FROM public.reserve_scheduled_email_atomic('review_request','cf230000-0000-4000-8000-000000000002',NULL);
 operation:=r.operation_id;
 PERFORM public.prepare_scheduled_email_atomic(operation,jsonb_build_object('from','a@example.invalid','to',r.snapshot->>'email','subject','Synthetic','html','Synthetic'));
 PERFORM public.claim_webhook_retry_queue_v2(ARRAY[operation],now());
END $$;
RESET ROLE;
UPDATE public.bookings SET account_deleted_at=now() WHERE id='cf230000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $$ DECLARE fence record; operation uuid; BEGIN
 SELECT o.id INTO operation FROM public.scheduled_email_operations o WHERE o.source_id='cf230000-0000-4000-8000-000000000002';
 SELECT * INTO fence FROM public.start_scheduled_email_delivery(operation,now(),true);
 PERFORM pg_temp.assert_withdrawn(fence.outcome='superseded','fence checks the retirement marker even when the snapshot still matches');
END $$;
RESET ROLE;
SELECT 'review request withdrawn-account checks passed';
ROLLBACK;
