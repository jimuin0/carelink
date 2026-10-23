\set ON_ERROR_STOP on
-- Dedicated synthetic shadow DB only; every change rolls back and no provider is called.
-- 運営ニュースレターの宛先と配信停止は、確認済みのログインメール（auth.users）で決まる（20261023150100）。
-- profiles.email と email_unsubscribed は本人が PostgREST で自由に書き換えられるので、ここでは
-- postgres で同じ結果を直接作る（PATCH /rest/v1/profiles?id=eq.<自分> と同じ）。
--   1. 他人のアドレスを自分の profiles.email に書いて配信停止にしても、その人への配信は止まらない
--   2. オーナーが profiles.email を第三者のアドレスにしても、そこへは届かない（確認済みログインメールへ届く）
--   3. メール未確認のオーナーは宛先にしない
--   4. 本人の配信停止（マイページ）は今までどおり宛先から外れ、積まれたジョブも送信直前に止まる
--   5. 配信停止リンクのトークン方式は、トークンの持ち主の確認済みログインメールを止める（profiles.email ではない）
--   6. アドレス指定の配信停止は、そのアドレスを確認済みログインメールに持つアカウントの旗も立てる
--   7. 3 関数ともブラウザのロールからは呼べない
-- 20261023150100 より前の定義では 1・2・5 の assert が落ちる。
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ed720000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_audience(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'newsletter audience fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.recipient(p_kind text,p_email text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.newsletter_current_recipients(p_kind) r WHERE r=p_email) $$;
CREATE FUNCTION pg_temp.claim_newsletter(q uuid,stamp timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE public.webhook_retry_queue SET scheduled_at=LEAST(scheduled_at,stamp) WHERE id=q AND status='pending';
 IF to_regprocedure('public.claim_webhook_retry_queue_v2(uuid[],timestamp with time zone)') IS NOT NULL THEN
  EXECUTE 'SELECT count(*) FROM public.claim_webhook_retry_queue_v2(ARRAY[$1],$2)' USING q,stamp;
 ELSE UPDATE public.webhook_retry_queue SET status='processing',claimed_at=stamp WHERE id=q; END IF;
 PERFORM pg_temp.assert_audience((SELECT status='processing' AND claimed_at=stamp FROM public.webhook_retry_queue WHERE id=q),'version-compatible queue claim');
END $$;
CREATE FUNCTION pg_temp.start(p_email text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE q uuid; stamp timestamptz:=clock_timestamp(); result text;
BEGIN
 SELECT r.queue_id INTO q FROM public.newsletter_send_recipients r JOIN public.newsletter_send_operations o USING(operation_id)
  WHERE o.campaign_id='ed720002-0000-4000-8000-000000000001' AND r.email=p_email;
 PERFORM pg_temp.assert_audience(q IS NOT NULL,'queued recipient '||p_email);
 PERFORM pg_temp.claim_newsletter(q,stamp);
 SELECT outcome INTO result FROM public.start_newsletter_delivery(q,stamp);
 RETURN result;
END $$;

-- 7. ブラウザのロールからは呼べない
SELECT pg_temp.assert_audience(bool_and(NOT has_function_privilege('anon',f,'EXECUTE') AND NOT has_function_privilege('authenticated',f,'EXECUTE')
 AND has_function_privilege('service_role',f,'EXECUTE')),'service-only audience, fence and unsubscribe')
FROM unnest(ARRAY['public.newsletter_current_recipients(text)','public.start_newsletter_delivery(uuid,timestamptz)',
 'public.unsubscribe_newsletter_atomic(text,text)']) f;

-- A＝オーナー / X＝オーナーではない攻撃者 / B＝profiles.email を第三者のアドレスにしたオーナー /
-- C＝メール未確認のオーナー / P＝運営 / T＝お気に入りダイジェストの配信停止トークンを持つ会員 /
-- F＝profiles.email だけ書き換えた会員（ログインメールは aud-flag@）
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed720000-0000-4000-8000-00000000000a','aud-owner-a@example.invalid',now()),
 ('ed720000-0000-4000-8000-0000000000aa','aud-attacker@example.invalid',now()),
 ('ed720000-0000-4000-8000-00000000000b','Aud-Owner-B@example.invalid',now()),
 ('ed720000-0000-4000-8000-00000000000c','aud-owner-c@example.invalid',NULL),
 ('ed720000-0000-4000-8000-0000000000ad','aud-admin@example.invalid',now()),
 ('ed720000-0000-4000-8000-0000000000ac','aud-token@example.invalid',now()),
 ('ed720000-0000-4000-8000-0000000000af','aud-flag@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='ed720000-0000-4000-8000-0000000000ad';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ed720001-0000-4000-8000-00000000000a','Audience A','synthetic-audience-a','その他','検証県','検証市','検証住所','draft'),
 ('ed720001-0000-4000-8000-00000000000b','Audience B','synthetic-audience-b','その他','検証県','検証市','検証住所','draft'),
 ('ed720001-0000-4000-8000-00000000000c','Audience C','synthetic-audience-c','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed720000-0000-4000-8000-00000000000a','ed720001-0000-4000-8000-00000000000a','owner'),
 ('ed720000-0000-4000-8000-00000000000b','ed720001-0000-4000-8000-00000000000b','owner'),
 ('ed720000-0000-4000-8000-00000000000c','ed720001-0000-4000-8000-00000000000c','owner');
-- 本人が自分の profiles 行だけを書き換える（RLS の範囲内でできること）
UPDATE public.profiles SET email='aud-owner-a@example.invalid',email_unsubscribed=true WHERE id='ed720000-0000-4000-8000-0000000000aa';
UPDATE public.profiles SET email='aud-third-party@example.invalid' WHERE id='ed720000-0000-4000-8000-00000000000b';

SELECT pg_temp.assert_audience(pg_temp.recipient('owner_monthly','aud-owner-a@example.invalid'),'1. another account cannot stop the owner by writing her address');
SELECT pg_temp.assert_audience(NOT pg_temp.recipient('owner_monthly','aud-attacker@example.invalid'),'non-owner is not an owner recipient');
SELECT pg_temp.assert_audience(pg_temp.recipient('owner_monthly','aud-owner-b@example.invalid'),'2. owner is reached at the confirmed login email (case-folded)');
SELECT pg_temp.assert_audience(NOT pg_temp.recipient('owner_monthly','aud-third-party@example.invalid'),'2. a third-party address written in profiles.email receives nothing');
SELECT pg_temp.assert_audience(NOT pg_temp.recipient('owner_monthly','aud-owner-c@example.invalid'),'3. unconfirmed owner is not a recipient');

-- 送信までの経路: 宛先を確定して積み、送信直前のフェンスを通す
INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,text_content,updated_at) VALUES
 ('ed720002-0000-4000-8000-000000000001','owner_monthly','Synthetic owner notice','<p>Synthetic</p>',NULL,'2026-10-23T00:00:00Z');
DO $$ DECLARE audience text[]; links jsonb; BEGIN
 SELECT array_agg(email ORDER BY email),jsonb_object_agg(email,'https://carelink-jp.com/unsubscribe?n='||repeat('a',64)) INTO audience,links
  FROM public.newsletter_current_recipients('owner_monthly') email;
 PERFORM public.publish_newsletter_send_operation('ed720000-0000-4000-8000-0000000000ad','ed720002-0000-4000-8000-000000000001',
  '2026-10-23T00:00:00Z',audience,links,'CareLink <newsletter@carelink-jp.com>');
END $$;
SELECT pg_temp.assert_audience(NOT EXISTS(SELECT 1 FROM public.newsletter_send_recipients r JOIN public.newsletter_send_operations o USING(operation_id)
 WHERE o.campaign_id='ed720002-0000-4000-8000-000000000001' AND r.email IN ('aud-third-party@example.invalid','aud-owner-c@example.invalid')),'nothing is queued for the third party or the unconfirmed owner');
SELECT pg_temp.assert_audience(pg_temp.start('aud-owner-a@example.invalid')='ready','1. the fence does not suppress the owner because of another account''s row');

-- 4. 本人の配信停止（マイページ）は送信直前にも効く
SET LOCAL ROLE service_role;
SELECT public.set_newsletter_preference_atomic('ed720000-0000-4000-8000-00000000000b',false);
RESET ROLE;
SELECT pg_temp.assert_audience(NOT pg_temp.recipient('owner_monthly','aud-owner-b@example.invalid'),'4. own opt-out removes the owner');
SELECT pg_temp.assert_audience(pg_temp.start('aud-owner-b@example.invalid')='superseded','4. own opt-out stops an already queued delivery');

-- 5. トークン方式の配信停止は、トークンの持ち主の確認済みログインメールを止める
INSERT INTO public.email_unsubscribe_tokens(token,user_id) VALUES(repeat('c',64),'ed720000-0000-4000-8000-0000000000ac');
UPDATE public.profiles SET email='aud-owner-a@example.invalid' WHERE id='ed720000-0000-4000-8000-0000000000ac';
SET LOCAL ROLE service_role;
SELECT public.unsubscribe_newsletter_atomic(NULL,repeat('c',64));
RESET ROLE;
SELECT pg_temp.assert_audience(NOT EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))='aud-owner-a@example.invalid'),'5. a token cannot stop the address written in its profiles.email');
SELECT pg_temp.assert_audience(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='aud-token@example.invalid' AND NOT is_active),'5. the token stops its own confirmed login email');
SELECT pg_temp.assert_audience((SELECT email_unsubscribed FROM public.profiles WHERE id='ed720000-0000-4000-8000-0000000000ac'),'5. the token holder account is flagged');
SELECT pg_temp.assert_audience(pg_temp.recipient('owner_monthly','aud-owner-a@example.invalid'),'5. the owner still receives');
SELECT pg_temp.assert_audience((SELECT used_at IS NOT NULL FROM public.email_unsubscribe_tokens WHERE token=repeat('c',64)),'5. token consumed');

-- 6. アドレス指定の配信停止は、そのアドレスを確認済みログインメールに持つアカウントの旗も立てる
UPDATE public.profiles SET email='aud-flag-elsewhere@example.invalid' WHERE id='ed720000-0000-4000-8000-0000000000af';
SET LOCAL ROLE service_role;
SELECT public.unsubscribe_newsletter_atomic('AUD-Flag@example.invalid ',NULL);
RESET ROLE;
SELECT pg_temp.assert_audience((SELECT email_unsubscribed FROM public.profiles WHERE id='ed720000-0000-4000-8000-0000000000af'),'6. owner of the address by login email is flagged');
SELECT pg_temp.assert_audience(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='aud-flag@example.invalid' AND NOT is_active),'6. address-level stop recorded');

SELECT 'newsletter confirmed-login-email audience, fence and unsubscribe checks passed';
ROLLBACK;
