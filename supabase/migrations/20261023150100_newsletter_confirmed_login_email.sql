-- 運営ニュースレターの宛先と配信停止の判定を、確認済みのログインメール（auth.users）にそろえる（2026年10月23日）。
--
-- 【欠陥】施設オーナー向けニュースレターの宛先（newsletter_current_recipients）と、アプリ側の同じ計算
--   （src/lib/newsletter-send.ts の collectNewsletterRecipients）は、宛先も配信停止の判定も profiles.email を
--   見ていた。profiles.email と email_unsubscribed は本人が PostgREST で自由に書き換えられる（列の GRANT 制限が無い）。
--   (a) 誰でも自分の profiles を {email: 他人のアドレス, email_unsubscribed: true} にするだけで、そのアドレスの
--       オーナーへの運営のお知らせを黙って止められた。止められた本人がマイページで「受け取る」にしても、
--       抑止しているのは他人の行なので外れず、画面は「受け取る」のまま届かない。
--   (b) 下書き施設を作ってオーナーになり、profiles.email を第三者のアドレスにすると、CareLink 名義の
--       オーナー向けメールがその第三者へ届いた。
--   メール末尾の配信停止リンクのうちトークン方式（お気に入りダイジェストの末尾）も、止める宛先を
--   profiles.email から決めていた。ダイジェストは確認済みのログインメールへ送っているので、自分のトークンを
--   持ったまま profiles.email を他人のアドレスに書き換えてリンクを開くと、そのアドレスの全メールを止められた。
--
-- 【直し方】口コミ依頼（20261023050000 の email_address_opted_out）・マイページの再購読
--   （20261022220000 の set_newsletter_preference_atomic）と同じく、持ち主を Supabase Auth が確認済みの
--   ログインメール（auth.users.email・email_confirmed_at あり）だけを使う。
--   1. newsletter_current_recipients
--      - オーナーの宛先は auth.users の確認済みログインメール（未確認のアカウントは宛先にしない）
--      - 抑止は email_address_opted_out(宛先) に一本化する（配信停止リンクの停止行＋確認済みログインメールの
--        持ち主の email_unsubscribed）。抑止の定義を口コミ依頼と同じ 1 か所にする。
--      アプリ側（collectNewsletterRecipients）は自前の計算をやめ、この関数を service_role で呼ぶだけにした
--      （二重実装をやめる。publish 時の宛先一致検査は同じ関数同士の比較になる）。
--   2. start_newsletter_delivery（送信直前のフェンス）のロック対象に、確認済みログインメールでその宛先を
--      持つアカウントを足す（従来の profiles.email で引くアカウントも残す）。判定は 1. を呼ぶので自動で新しい定義になる。
--   3. unsubscribe_newsletter_atomic のトークン方式は、トークンの持ち主の確認済みログインメールを止める。
--      アドレス指定（署名付きリンク）で止めたときは、そのアドレスを確認済みログインメールに持つアカウントの
--      旗も立てる（従来の profiles.email が一致するアカウントと、トークンの持ち主はそのまま）。
--
-- 【影響】profiles.email と確認済みログインメールが同じアカウント（アプリには profiles.email を変える経路が無く、
--   作成時は同じ値が入る＝通常はすべて）は、宛先も配信停止も今までと同じ。変わるのは、
--   profiles.email を書き換えたアカウント（その値では届かず・止められなくなる）と、メール未確認のオーナー
--   （宛先から外れる）だけ。事前に数えるなら scripts/diagnose-newsletter-owner-audience.sql。
--
-- 【デプロイ順】どちらが先でも安全。
--   - アプリが先: 新しいアプリは宛先をこの関数から受け取るので、適用前は旧定義のまま一貫して動く。
--   - migration が先: デプロイ前のアプリ（origin/fix/fourth-sweep-integration）は宛先を自前で計算するので、
--     上の【影響】に当たるアカウントがあると publish の宛先一致検査が NEWSLETTER_AUDIENCE_CONFLICT（409）で止まる
--     （誤った宛先へは送らない）。デプロイ後に配信し直せばよい。
--   推奨はアプリのデプロイ直後に適用すること。関数本体が変わるので期待スキーマ（schema-fingerprint.expected.json）の
--   body_md5 は CI が生成する。適用とデプロイは同じ日のうちに続けて行う（schema-drift-check が 1 回だけ差分を報告しうる）。
--
-- 各関数の本体は 20261009021921 の定義（以後の上書きは無い）をそのまま写し、上記だけを変えた。
-- 属性（SECURITY DEFINER・search_path）と REVOKE/GRANT も同じ内容で再設定する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- 1. 宛先（本体は 20261009021921 と同一＋オーナー宛先と抑止の 2 か所）。
CREATE OR REPLACE FUNCTION public.newsletter_current_recipients(p_kind text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
  SELECT lower(btrim(s.email)) email FROM public.newsletter_subscriptions s WHERE s.is_active
   AND s.email IS NOT NULL AND s.subscription_type IN (CASE WHEN p_kind='owner_monthly' THEN 'owner_monthly' ELSE 'user_digest' END,'all')
  UNION
  SELECT lower(btrim(u.email)) FROM public.facility_members m JOIN auth.users u ON u.id=m.user_id
   WHERE p_kind='owner_monthly' AND m.role='owner' AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
 ) SELECT DISTINCT c.email FROM candidates c WHERE c.email<>''
 AND NOT public.email_address_opted_out(c.email)
 ORDER BY c.email;
$$;
REVOKE ALL ON FUNCTION public.newsletter_current_recipients(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_current_recipients(text) TO service_role;

-- 2. 送信直前のフェンス（本体は 20261009021921 と同一＋ロック対象の 3 文）。
CREATE OR REPLACE FUNCTION public.start_newsletter_delivery(p_queue_id uuid,p_claimed_at timestamptz)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE; r public.newsletter_send_recipients%ROWTYPE; op public.newsletter_send_operations%ROWTYPE; stamp timestamptz; account uuid;
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR p_claimed_at IS NULL OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
  RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz;RETURN; END IF;
 SELECT * INTO r FROM public.newsletter_send_recipients WHERE queue_id=q.id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz;RETURN; END IF;
 SELECT * INTO op FROM public.newsletter_send_operations WHERE operation_id=r.operation_id;
 IF q.webhook_type<>'email' OR q.target_id IS DISTINCT FROM r.email OR q.email_envelope->>'to' IS DISTINCT FROM r.email
  OR q.payload->>'newsletter_delivery_version'<>'1' OR q.payload->>'newsletter_recipient_id' IS DISTINCT FROM r.recipient_id::text
  OR q.payload->>'newsletter_operation_id' IS DISTINCT FROM r.operation_id::text OR q.payload->>'campaign_id' IS DISTINCT FROM op.campaign_id::text THEN
  RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz;RETURN; END IF;
 -- Account deletion/ownership changes cannot invalidate the current audience
 -- evidence between this check and the durable start. Anonymous subscribers
 -- are protected by their existing subscription row, without global locks.
 -- 2026-10-23: the audience and its opt-outs follow the confirmed login email
 -- (auth.users), so the accounts owning the address by that email are locked
 -- too; accounts naming it in the self-editable profiles.email stay locked.
 FOR account IN SELECT p.id FROM public.profiles p WHERE lower(btrim(p.email))=r.email
  OR p.id IN (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email))=r.email) ORDER BY p.id LOOP
  PERFORM public.lock_booking_account(account);
 END LOOP;
 PERFORM 1 FROM public.profiles p WHERE lower(btrim(p.email))=r.email
  OR p.id IN (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email))=r.email) ORDER BY p.id FOR SHARE OF p;
 PERFORM 1 FROM public.facility_members m WHERE m.user_id IN (SELECT p.id FROM public.profiles p WHERE lower(btrim(p.email))=r.email)
  OR m.user_id IN (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email))=r.email) ORDER BY m.id FOR SHARE OF m;
 PERFORM 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=r.email ORDER BY id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.newsletter_current_recipients(op.campaign_snapshot->>'campaign_type') email WHERE email=r.email) THEN
  UPDATE public.newsletter_send_recipients SET suppressed_authorized=true WHERE recipient_id=r.recipient_id;
  UPDATE public.webhook_retry_queue SET status='failed',last_error='newsletter_suppressed',processed_at=clock_timestamp() WHERE id=q.id;
  RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz;RETURN; END IF;
 stamp:=clock_timestamp();
 UPDATE public.newsletter_send_recipients SET start_claimed_at=p_claimed_at,start_time=stamp,rejected_retry_authorized=false WHERE recipient_id=r.recipient_id;
 UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE id=q.id;
 RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_newsletter_delivery(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_newsletter_delivery(uuid,timestamptz) TO service_role;

-- 3. 配信停止（本体は 20261009021921 と同一＋宛先の決め方とロック・旗の対象）。
CREATE OR REPLACE FUNCTION public.unsubscribe_newsletter_atomic(p_email text,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text; uid uuid; account uuid; token_row public.email_unsubscribe_tokens%ROWTYPE; was_stopped boolean;
BEGIN
 IF (p_email IS NULL)=(p_token IS NULL) THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 IF p_token IS NOT NULL THEN
  IF p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
  uid:=token_row.user_id;
  -- 2026-10-23: the token's own account decides the address by its confirmed
  -- login email (where the digest carrying the token was sent), never by the
  -- self-editable profiles.email (which let a token holder stop another address).
  SELECT lower(btrim(u.email)) INTO address FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid AND u.email_confirmed_at IS NOT NULL;
  IF address IS NULL OR address='' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_UNAVAILABLE'; END IF;
 ELSE address:=lower(btrim(p_email)); END IF;
 IF address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(address)>254 THEN
  RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 FOR account IN SELECT p.id FROM public.profiles p WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address) ORDER BY p.id LOOP
  PERFORM public.lock_booking_account(account);
 END LOOP;
 PERFORM 1 FROM public.profiles p WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address) ORDER BY p.id FOR UPDATE OF p;
 PERFORM 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address ORDER BY id FOR UPDATE;
 IF p_token IS NOT NULL THEN
  IF address IS DISTINCT FROM (SELECT lower(btrim(u.email)) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid AND u.email_confirmed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_CHANGED' USING ERRCODE='40001'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_TOKEN_CHANGED' USING ERRCODE='40001'; END IF;
  IF token_row.used_at IS NOT NULL THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
 END IF;
 was_stopped:=EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address AND NOT is_active);
 UPDATE public.profiles p SET email_unsubscribed=true WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address);
 UPDATE public.newsletter_subscriptions SET is_active=false,unsubscribed_at=clock_timestamp() WHERE lower(btrim(email))=address;
 -- Guest addresses also acquire a durable all-mail suppression row. Existing
 -- case variants remain inactive; the canonical row handles exact retries.
 INSERT INTO public.newsletter_subscriptions(email,subscription_type,is_active,unsubscribed_at,source)
 VALUES(address,'all',false,clock_timestamp(),'unsubscribe')
 ON CONFLICT(email) DO UPDATE SET is_active=false,unsubscribed_at=excluded.unsubscribed_at;
 IF p_token IS NOT NULL THEN
  UPDATE public.email_unsubscribe_tokens SET used_at=coalesce(used_at,clock_timestamp()) WHERE token=p_token AND user_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_TOKEN_CHANGED' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'already',was_stopped);
END $$;
REVOKE ALL ON FUNCTION public.unsubscribe_newsletter_atomic(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unsubscribe_newsletter_atomic(text,text) TO service_role;
