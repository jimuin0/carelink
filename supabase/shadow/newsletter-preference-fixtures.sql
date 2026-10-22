\set ON_ERROR_STOP on
-- Dedicated synthetic shadow DB only; every change rolls back and no provider is called.
-- マイページ「お知らせメールを受け取る」（set_newsletter_preference_atomic・20261022180000）を実 DB で確かめる。
--   1. メールの配信停止リンクで止めた後、profiles の旗だけ戻しても宛先に戻らない（直す前の欠陥の再現）
--   2. この関数で「受け取る」に戻すと、旗と抑止行がまとめて外れ、宛先に戻る
--   3. 他人の宛先の抑止は外せない（profiles.email を書き換えても、確認済みログインメールしか見ない）
--   4. ブラウザ（anon / authenticated）からは呼べない
--   5. メールアドレス未確認のアカウントは旗だけ戻し、抑止行には触れない
--   6. アカウント作成前に配信停止リンクで止めた宛先は、旗が立たなくても表示（get_newsletter_preference）が
--      「受け取らない」になり、ON を 1 回押せば届くようになる
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'ed210000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_pref(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'newsletter preference fixture failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.recipient(p_kind text,p_email text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.newsletter_current_recipients(p_kind) r WHERE r=p_email) $$;

SELECT pg_temp.assert_pref(NOT has_function_privilege('anon','public.set_newsletter_preference_atomic(uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.set_newsletter_preference_atomic(uuid,boolean)','EXECUTE')
 AND has_function_privilege('service_role','public.set_newsletter_preference_atomic(uuid,boolean)','EXECUTE'),'service-only preference writer');
SELECT pg_temp.assert_pref(NOT has_function_privilege('anon','public.get_newsletter_preference(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.get_newsletter_preference(uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.get_newsletter_preference(uuid)','EXECUTE'),'service-only preference reader');

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed210000-0000-4000-8000-000000000001','pref-owner@example.invalid',now()),
 ('ed210000-0000-4000-8000-000000000002','Pref-Subscriber@example.invalid',now()),
 ('ed210000-0000-4000-8000-000000000003','pref-attacker@example.invalid',now()),
 ('ed210000-0000-4000-8000-000000000004','pref-noprofile@example.invalid',now()),
 ('ed210000-0000-4000-8000-000000000005','pref-unconfirmed@example.invalid',NULL);
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ed210001-0000-4000-8000-000000000001','Preference A','synthetic-newsletter-preference-a','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed210000-0000-4000-8000-000000000001','ed210001-0000-4000-8000-000000000001','owner');
INSERT INTO public.newsletter_subscriptions(user_id,email,subscription_type,is_active) VALUES
 ('ed210000-0000-4000-8000-000000000002','pref-subscriber@example.invalid','user_digest',true);
SELECT pg_temp.assert_pref(pg_temp.recipient('owner_monthly','pref-owner@example.invalid'),'owner starts as recipient');
SELECT pg_temp.assert_pref(pg_temp.recipient('user_digest','pref-subscriber@example.invalid'),'subscriber starts as recipient');

-- メール末尾の配信停止リンク（/api/unsubscribe の方式C と同じ呼び方）
SELECT public.unsubscribe_newsletter_atomic('pref-owner@example.invalid',NULL);
SELECT public.unsubscribe_newsletter_atomic('pref-subscriber@example.invalid',NULL);
SELECT pg_temp.assert_pref(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='pref-owner@example.invalid'
 AND NOT is_active AND source='unsubscribe' AND user_id IS NULL),'link creates a suppression row the owner cannot see');
SELECT pg_temp.assert_pref(NOT pg_temp.recipient('owner_monthly','pref-owner@example.invalid'),'owner suppressed by link');

-- 1. 直す前の経路（profiles の旗だけ戻す）では届かないまま
UPDATE public.profiles SET email_unsubscribed=false WHERE id='ed210000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_pref(NOT pg_temp.recipient('owner_monthly','pref-owner@example.invalid'),'flag-only resume keeps suppression (old defect)');
UPDATE public.profiles SET email_unsubscribed=true WHERE id='ed210000-0000-4000-8000-000000000001';

-- 3. 自分の profiles.email を他人のアドレスに書き換えてから「受け取る」にしても、他人の抑止は外れない
UPDATE public.profiles SET email='pref-owner@example.invalid' WHERE id='ed210000-0000-4000-8000-000000000003';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000003',true)
 = jsonb_build_object('success',true,'receive',true,'cleared',0,'reactivated',0),'attacker clears nothing');
RESET ROLE;
SELECT pg_temp.assert_pref(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='pref-owner@example.invalid' AND NOT is_active),'other mailbox suppression kept');
SELECT pg_temp.assert_pref((SELECT email_unsubscribed FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000001'),'other account flag kept');
UPDATE public.profiles SET email='pref-attacker@example.invalid' WHERE id='ed210000-0000-4000-8000-000000000003';

-- 2. 本人が「受け取る」に戻すと、旗と抑止行がまとめて外れ、宛先に戻る
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000001',true)
 = jsonb_build_object('success',true,'receive',true,'cleared',1,'reactivated',0),'owner resume receipt');
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000002',true)
 = jsonb_build_object('success',true,'receive',true,'cleared',0,'reactivated',1),'subscriber resume receipt');
RESET ROLE;
SELECT pg_temp.assert_pref(pg_temp.recipient('owner_monthly','pref-owner@example.invalid'),'owner receives owner newsletter again');
SELECT pg_temp.assert_pref(pg_temp.recipient('user_digest','pref-subscriber@example.invalid'),'subscriber receives digest again');
SELECT pg_temp.assert_pref(NOT pg_temp.recipient('user_digest','pref-owner@example.invalid'),'suppression row is not turned into an all-mail subscription');
SELECT pg_temp.assert_pref(NOT EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='pref-owner@example.invalid'),'hidden suppression row removed');
SELECT pg_temp.assert_pref((SELECT is_active AND unsubscribed_at IS NULL FROM public.newsletter_subscriptions WHERE email='pref-subscriber@example.invalid'),'prior subscription reactivated');
SELECT pg_temp.assert_pref((SELECT NOT email_unsubscribed FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000001')
 AND (SELECT NOT email_unsubscribed FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000002'),'flags cleared with suppression');

-- 5. メールアドレス未確認のアカウント: 旗は戻るが、持ち主を確認できない宛先の抑止は外さない
SELECT public.unsubscribe_newsletter_atomic('pref-unconfirmed@example.invalid',NULL);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000005',true)
 = jsonb_build_object('success',true,'receive',true,'cleared',0,'reactivated',0),'unconfirmed account clears nothing');
RESET ROLE;
SELECT pg_temp.assert_pref(EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE email='pref-unconfirmed@example.invalid' AND NOT is_active),'unconfirmed mailbox suppression kept');
SELECT pg_temp.assert_pref((SELECT NOT email_unsubscribed FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000005'),'unconfirmed account flag still follows the toggle');

-- 受け取らない（OFF）は旗だけで宛先から外れる
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000001',false)
 = jsonb_build_object('success',true,'receive',false,'cleared',0,'reactivated',0),'owner stop receipt');
RESET ROLE;
SELECT pg_temp.assert_pref(NOT pg_temp.recipient('owner_monthly','pref-owner@example.invalid'),'stop removes owner from recipients');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.get_newsletter_preference('ed210000-0000-4000-8000-000000000001')
 = jsonb_build_object('receive',false,'unsubscribed',true,'suppressed',false),'state after stop');
RESET ROLE;

-- 6. アカウント作成【前】に配信停止リンクで止めた宛先。profiles の行がまだ無いので旗は立たず、抑止行だけが残る。
--    旗だけを見るとトグルは「受け取る」に見えるのに届かない。表示は抑止行も見て「受け取らない」を返し、
--    ON を 1 回押せば抑止行が外れて表示も宛先も戻る。
SELECT public.unsubscribe_newsletter_atomic('pref-late@example.invalid',NULL);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ed210000-0000-4000-8000-000000000006','Pref-Late@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ed210001-0000-4000-8000-000000000002','Preference B','synthetic-newsletter-preference-b','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('ed210000-0000-4000-8000-000000000006','ed210001-0000-4000-8000-000000000002','owner');
SELECT pg_temp.assert_pref((SELECT NOT email_unsubscribed FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000006'),'late account flag is not set by the earlier link');
SELECT pg_temp.assert_pref(NOT pg_temp.recipient('owner_monthly','pref-late@example.invalid'),'late account suppressed by the earlier link');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_pref(public.get_newsletter_preference('ed210000-0000-4000-8000-000000000006')
 = jsonb_build_object('receive',false,'unsubscribed',false,'suppressed',true),'state reports the suppression the flag misses');
SELECT pg_temp.assert_pref(public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000006',true)
 = jsonb_build_object('success',true,'receive',true,'cleared',1,'reactivated',0),'one resume clears the earlier suppression');
SELECT pg_temp.assert_pref(public.get_newsletter_preference('ed210000-0000-4000-8000-000000000006')
 = jsonb_build_object('receive',true,'unsubscribed',false,'suppressed',false),'state follows the resume');
RESET ROLE;
SELECT pg_temp.assert_pref(pg_temp.recipient('owner_monthly','pref-late@example.invalid'),'late account receives owner newsletter after one resume');

-- 入力とアカウントの検証
DELETE FROM public.profiles WHERE id='ed210000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.set_newsletter_preference_atomic(NULL,true); RAISE EXCEPTION 'null user accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_PREFERENCE_INVALID' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000001',NULL); RAISE EXCEPTION 'null preference accepted';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_PREFERENCE_INVALID' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_newsletter_preference_atomic('ed21ffff-0000-4000-8000-000000000009',true); RAISE EXCEPTION 'unknown account accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_ACCOUNT_UNAVAILABLE' THEN RAISE; END IF; END;
 BEGIN PERFORM public.set_newsletter_preference_atomic('ed210000-0000-4000-8000-000000000004',true); RAISE EXCEPTION 'missing profile accepted';
 EXCEPTION WHEN no_data_found THEN IF SQLERRM<>'NEWSLETTER_PREFERENCE_PROFILE_MISSING' THEN RAISE; END IF; END;
 BEGIN PERFORM public.get_newsletter_preference(NULL); RAISE EXCEPTION 'null user read';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'NEWSLETTER_PREFERENCE_INVALID' THEN RAISE; END IF; END;
 BEGIN PERFORM public.get_newsletter_preference('ed210000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'missing profile read';
 EXCEPTION WHEN no_data_found THEN IF SQLERRM<>'NEWSLETTER_PREFERENCE_PROFILE_MISSING' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

SELECT 'newsletter preference resume/stop/isolation/unconfirmed/pre-signup-suppression/privilege checks passed';
ROLLBACK;
