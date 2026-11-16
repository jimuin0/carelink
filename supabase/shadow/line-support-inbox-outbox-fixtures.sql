-- Synthetic, transaction-rolled-back support acceptance. Never run on production.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_database() !~ '^carelink_shadow' THEN RAISE EXCEPTION 'disposable CareLink shadow database required'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_support(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'LINE support fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('cae10000-0000-4000-8000-000000000001','support-admin@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='cae10000-0000-4000-8000-000000000001';
UPDATE public.line_support_settings SET rollout='observe',recipient_verified=false,recipient_id=NULL,operator_id=NULL;
DO $$ DECLARE
 actor uuid:='cae10000-0000-4000-8000-000000000001';
 customer text:='U11111111111111111111111111111111';
 recipient text:='U22222222222222222222222222222222';
 lease uuid:='cae20000-0000-4000-8000-000000000001';
 delivery uuid:='cae30000-0000-4000-8000-000000000001';
 retry uuid:='cae40000-0000-4000-8000-000000000001';
 facts text:=repeat('a',64); pairhash text:=repeat('b',64); c uuid; r jsonb;
 BEGIN
 PERFORM pg_temp.assert_support(NOT has_table_privilege('anon','public.line_support_events','SELECT'),'anonymous cannot read private messages');
 PERFORM pg_temp.assert_support(NOT has_table_privilege('authenticated','public.line_support_events','SELECT'),'browser role cannot bypass admin API');
 PERFORM pg_temp.assert_support(NOT has_table_privilege('service_role','public.line_support_settings','UPDATE'),'service mutations require RPC');
 PERFORM pg_temp.assert_support(NOT has_function_privilege('anon','public.manage_line_support(uuid,text,jsonb)','EXECUTE'),'anonymous cannot mutate support');
 r:=public.accept_line_support_event('support-fixture-e1',customer,'text','support-fixture-m1','相談の原文','2030-01-01T10:00:00Z',true);
 c:=(r->>'conversation_id')::uuid;
 PERFORM pg_temp.assert_support(r->>'status'='accepted','durable event receipt');
 PERFORM pg_temp.assert_support((SELECT mode='human' FROM public.line_support_conversations WHERE id=c),'manual fence precedes generation');
 r:=public.accept_line_support_event('support-fixture-e1',customer,'text','support-fixture-m1','相談の原文','2030-01-01T10:00:00Z',true);
 PERFORM pg_temp.assert_support(r->>'status'='duplicate','redelivery deduplicated');
 BEGIN
  PERFORM public.accept_line_support_event('support-fixture-e1',customer,'text','support-fixture-m1','別の原文','2030-01-01T10:00:00Z',true);
  RAISE EXCEPTION 'event collision accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.assert_support(public.claim_line_support_event('support-fixture-e1',lease) IS NOT NULL,'one worker owns generation');
 PERFORM pg_temp.assert_support(public.claim_line_support_event('support-fixture-e1',lease) IS NULL,'second worker cannot own generation');
 r:=public.prepare_line_support_delivery('support-fixture-e1',lease,delivery,retry,'operator_draft',facts,'未送信の返信案','synthetic-model');
 PERFORM pg_temp.assert_support(r->>'status'='recipient_unbound','unverified recipient never receives draft');
 PERFORM pg_temp.assert_support((SELECT count(*)=1 FROM public.line_support_drafts WHERE conversation_id=c),'unbound draft retained');
 PERFORM public.manage_line_support(actor,'pair_start',jsonb_build_object('hash',pairhash));
 PERFORM pg_temp.assert_support(public.confirm_line_support_pair_candidate(pairhash,recipient),'signed personal candidate required');
 PERFORM pg_temp.assert_support(NOT public.confirm_line_support_pair_candidate(pairhash,customer),'pair code cannot be replayed');
 PERFORM public.manage_line_support(actor,'pair_confirm','{}');
 r:=public.accept_line_support_event('support-fixture-e2',customer,'text','support-fixture-m2','登録方法','2030-01-01T10:01:00Z',false);
 PERFORM pg_temp.assert_support((SELECT mode='human' FROM public.line_support_conversations WHERE id=c),'FAQ follow-up cannot escape human mode');
 PERFORM public.claim_line_support_event('support-fixture-e2',lease);
 delivery:='cae30000-0000-4000-8000-000000000002';retry:='cae40000-0000-4000-8000-000000000002';
 r:=public.prepare_line_support_delivery('support-fixture-e2',lease,delivery,retry,'customer_reply',facts,'勝手な顧客返信','policy');
 PERFORM pg_temp.assert_support(r->>'status'='human','human mode blocks automatic customer reply');
 PERFORM public.prepare_line_support_delivery('support-fixture-e2',lease,delivery,retry,'operator_draft',facts,'追記込みの案','synthetic-model');
 PERFORM pg_temp.assert_support(public.claim_line_support_delivery(delivery,facts) IS NULL,'observe never sends');
 PERFORM public.manage_line_support(actor,'rollout','{"mode":"live"}');
 PERFORM pg_temp.assert_support((SELECT state='superseded' FROM public.line_support_deliveries WHERE id=delivery),'live transition cannot flush observe backlog');
 PERFORM public.accept_line_support_event('support-fixture-e3',customer,'image','support-fixture-m3','[image]','2030-01-01T10:02:00Z',true);
 PERFORM public.claim_line_support_event('support-fixture-e3',lease);
 delivery:='cae30000-0000-4000-8000-000000000003';retry:='cae40000-0000-4000-8000-000000000003';
 PERFORM public.prepare_line_support_delivery('support-fixture-e3',lease,delivery,retry,'operator_draft',facts,'運営確認用の説明','synthetic-model','お客様へ送れる文案');
 r:=public.line_support_job_status('support-fixture-e3');
 PERFORM pg_temp.assert_support(r->>'delivery_id'=delivery::text,'prepared outbox survives worker interruption');
 PERFORM pg_temp.assert_support(EXISTS(SELECT 1 FROM jsonb_array_elements(public.line_support_work(NULL)) w WHERE w->>'event_id'='support-fixture-e3'),'operator recovery finds prepared outbox');
 r:=public.claim_line_support_delivery(delivery,facts);
 PERFORM pg_temp.assert_support(r->>'retry_key'=retry::text AND r->>'recipient_id'=recipient,'persisted recipient and retry key used');
 PERFORM pg_temp.assert_support(r->>'body'='運営確認用の説明' AND r->>'proposal_body'='お客様へ送れる文案','checklist and copyable proposal remain distinct and frozen');
 PERFORM pg_temp.assert_support(public.finish_line_support_delivery(delivery,'unknown',NULL),'uncertain outcome recorded');
 PERFORM pg_temp.assert_support(public.claim_line_support_delivery(delivery,facts) IS NULL,'uncertain send never automatically repeats');
 PERFORM public.accept_line_support_event('support-fixture-withdraw',customer,'unsend','support-fixture-m1','[unsend]','2030-01-01T10:03:00Z',true);
 PERFORM pg_temp.assert_support(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.line_support_history(c)) h WHERE h->>'body'='相談の原文'),'withdrawn text excluded from model context');
 PERFORM pg_temp.assert_support((SELECT body='相談の原文' FROM public.line_support_events WHERE event_id='support-fixture-e1'),'original record preserved');
 PERFORM public.manage_line_support(actor,'rollout','{"mode":"observe"}');
 PERFORM public.accept_line_support_event('support-fixture-observe-delayed','U99999999999999999999999999999999','text','observe-delayed','登録方法','2030-01-01T10:04:00Z',false,'{}','synthetic-reply-token');
 PERFORM public.manage_line_support(actor,'rollout','{"mode":"live"}');
 PERFORM public.claim_line_support_event('support-fixture-observe-delayed',lease);
 r:=public.prepare_line_support_delivery('support-fixture-observe-delayed',lease,'cae30000-0000-4000-8000-000000000004','cae40000-0000-4000-8000-000000000004','customer_reply',facts,'確認中に受信した案内','policy');
 PERFORM pg_temp.assert_support(r->>'status'='observed','unprocessed observe receipt cannot turn into a live send after rollout changes');
 PERFORM pg_temp.assert_support(public.claim_line_support_delivery('cae30000-0000-4000-8000-000000000004',facts) IS NULL,'delayed observe generation remains unsent');
 -- A real Reply API operation freezes the one-use token; uncertainty must become human review.
 PERFORM public.accept_line_support_event('support-fixture-reply','U88888888888888888888888888888888','text','reply-message','登録方法','2030-01-01T10:05:00Z',false,'{}','synthetic-one-use-token');
 PERFORM public.claim_line_support_event('support-fixture-reply',lease);
 delivery:='cae30000-0000-4000-8000-000000000005';retry:='cae40000-0000-4000-8000-000000000005';
 r:=public.prepare_line_support_delivery('support-fixture-reply',lease,delivery,retry,'customer_reply',facts,'現在の公開案内','policy');
 PERFORM pg_temp.assert_support(r->>'status'='prepared','fresh public Reply is prepared');
 r:=public.claim_line_support_delivery(delivery,facts,'現在の公開案内');
 PERFORM pg_temp.assert_support(r->>'reply_token'='synthetic-one-use-token','one-use Reply token is frozen before network');
 PERFORM pg_temp.assert_support(public.finish_line_support_delivery(delivery,'unknown',NULL),'uncertain Reply result persists');
 PERFORM pg_temp.assert_support(public.claim_line_support_delivery(delivery,facts,'現在の公開案内') IS NULL,'uncertain Reply cannot be attempted twice');
 PERFORM pg_temp.assert_support((SELECT state='pending' AND reply_fallback_reason='unknown' FROM public.line_support_events WHERE event_id='support-fixture-reply'),'uncertain Reply requeues only human review');
 PERFORM public.claim_line_support_event('support-fixture-reply',lease);
 r:=public.prepare_line_support_delivery('support-fixture-reply',lease,'cae30000-0000-4000-8000-000000000006','cae40000-0000-4000-8000-000000000006','operator_draft',facts,'履歴を確認してください','public-facts-review-v1','現在の公開案内');
 PERFORM pg_temp.assert_support(r->>'status'='prepared','human review has a distinct operation after uncertain Reply');
 -- Two unprocessed public questions must retain context instead of silently losing the first.
 PERFORM public.accept_line_support_event('support-fixture-sequence-a','U77777777777777777777777777777777','text','sequence-a','登録方法','2030-01-01T10:06:00Z',false,'{}','first-token');
 PERFORM public.accept_line_support_event('support-fixture-sequence-b','U77777777777777777777777777777777','text','sequence-b','掲載料','2030-01-01T10:07:00Z',false,'{}','second-token');
 PERFORM pg_temp.assert_support((SELECT c.mode='human' FROM public.line_support_conversations c JOIN public.line_support_events e ON e.conversation_id=c.id WHERE e.event_id='support-fixture-sequence-b'),'unresolved preceding message forces contextual human review');
 BEGIN
  PERFORM public.accept_line_support_events(jsonb_build_array(
   jsonb_build_object('event_id','support-fixture-rollback','line_user_id',customer,'message_type','text','message_id','batch-message','body','原文','occurred_at','2030-01-01T11:00:00Z'),
   jsonb_build_object('event_id','support-fixture-invalid','line_user_id','invalid','message_type','text','body','原文','occurred_at','2030-01-01T11:01:00Z')));
  RAISE EXCEPTION 'invalid batch accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM pg_temp.assert_support(NOT EXISTS(SELECT 1 FROM public.line_support_events WHERE event_id='support-fixture-rollback'),'batch failure rolls preceding event back');
 END $$;
ROLLBACK;
