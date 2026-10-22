-- 退会した会員に口コミ依頼メールが届く／退会前の配信停止が効かなくなる（2026年10月23日）。
--
-- 【症状】退会すると bookings.user_id は ON DELETE SET NULL で NULL になり、profiles 行は
--   CASCADE で消える（email_unsubscribed も一緒に消える）。予約行の email は残る。
--   口コミ依頼の 3 つの判定（候補一覧 list_scheduled_review_recipients・予約確保
--   reserve_scheduled_email_atomic・送信直前のフェンス start_scheduled_email_delivery）は
--   どれも「user_id が NULL ならゲスト＝配信停止の確認なし」と扱うため、来店完了から 7 日以内に
--   退会した会員の予約はゲスト予約として扱われ、退会者のアドレスへ口コミ依頼が届いていた。
--   退会前に「お知らせメールを受け取らない」にしていた人にも届く（本人の配信停止が退会で無効になる）。
--
-- 【直し方】
--   1. 退会と同じトランザクション（auth.users の BEFORE DELETE トリガ cleanup_deleting_account_personal_data）で、
--      その会員の予約を booking_member_withdrawals に記録する。ゲスト予約（作成時から user_id が NULL）と
--      退会者の予約を区別できる唯一の印になる。
--      印を bookings の列にしないのは、bookings は施設メンバーが PostgREST で全列を読めるため。
--      列にすると、店舗が「氏名つきの客が CareLink を退会したこと・その時刻」を知れてしまう
--      （予約の提供に要らない、新たに店舗へ開示される個人に関する情報）。この表は RLS 有効・ポリシー無し・
--      service_role の SELECT だけ（書くのは SECURITY DEFINER の退会トリガだけ）にして、店舗からは読めない。
--   2. 宛先アドレス単位の配信停止（email_address_opted_out）も見る。見るのは持ち主が確かめられる抑止だけ:
--      (a) newsletter_subscriptions の停止行（is_active=false）。書けるのは署名付きの配信停止リンク
--          （unsubscribe_newsletter_atomic）だけで、種別は問わない。リンクは既存行を種別そのまま停止にし、
--          'all' 行の INSERT も ON CONFLICT(email) で既存行の種別を残すため、'all' に限ると
--          購読行があった宛先の配信停止を見落とす（newsletter-send.ts・newsletter_current_recipients と同じ判定）。
--      (b) Supabase Auth が持ち主を確認済みのログインメール（auth.users.email・email_confirmed_at あり）の
--          アカウントが email_unsubscribed=true にしていること。profiles.email は本人が自由に書き換えられるので
--          照合に使わない（使うと、誰でも自分の profiles.email を他人のアドレスにして配信停止にするだけで、
--          そのアドレスで予約したゲストへの口コミ依頼を止められる。20261022220000 と同じ理由）。
--          auth.users を読むので SECURITY DEFINER（service_role だけが実行できる）。
--   3. 上の 2 つを 3 か所すべての判定に入れる。候補一覧だけだと、既に積まれたジョブや
--      競合中のジョブが送信直前のフェンスを素通りする。
--
-- 【既存データ】この migration より前に退会した会員の予約には印が無い。退会者かゲストかを後から
--   判定できる情報が残っていないため、推測によるデータ書き換え（バックフィル）はしない。
--   アドレス単位の配信停止（2.）は既存データにもそのまま効く。
--
-- 【デプロイ順】アプリより先に適用してよい。表と関数の追加、既存関数の判定を厳しくするだけ
--   （引数・戻り値・権限は変えない）なので、旧アプリはそのまま動く。
--   表・関数・権限の行は src/lib/schema-fingerprint.expected.json にも入れてある。schema-drift-check は
--   デプロイ済みアプリの期待値と比べるので、適用からデプロイまでの間に JST 02:40 を跨ぐと、その回だけ
--   差分として報告される。適用とデプロイは同じ日のうちに続けて行う。
--
-- 各関数の本体は直前の最新定義（cleanup: 20261008093027 / list・reserve: 20261013111506 /
-- start: 20261013123844）をそのまま写し、上記の判定だけを足した。属性（SECURITY DEFINER/INVOKER・
-- search_path）と REVOKE/GRANT も同じ内容で再設定する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE TABLE IF NOT EXISTS public.booking_member_withdrawals (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  withdrawn_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.booking_member_withdrawals IS
 'Bookings whose member account was deleted (bookings.user_id is then NULL). Tells a withdrawn member apart from a guest so scheduled mail is not sent. Written only by the account deletion trigger; service_role reads it; shops cannot.';
ALTER TABLE public.booking_member_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_member_withdrawals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.booking_member_withdrawals TO service_role;

-- 宛先アドレス単位の配信停止（上の 2.）。照合は lower(btrim(email))（newsletter_subscriptions_mailbox と同じ式）。
CREATE OR REPLACE FUNCTION public.email_address_opted_out(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT nullif(btrim(p_email),'') IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.newsletter_subscriptions n WHERE lower(btrim(n.email))=lower(btrim(p_email)) AND n.is_active IS FALSE)
  OR EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
   WHERE p.email_unsubscribed IS TRUE AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=lower(btrim(p_email))));
$$;
REVOKE ALL ON FUNCTION public.email_address_opted_out(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_address_opted_out(text) TO service_role;

-- 1. 退会と同じトランザクションで、その会員の予約を記録する（本体は 20261008093027 と同一＋1 文）。
--    BEFORE DELETE なので、この時点では bookings.user_id はまだ OLD.id（直後に FK の SET NULL で外れる）。
CREATE OR REPLACE FUNCTION public.cleanup_deleting_account_personal_data() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Keep the profile locked until Auth/profile CASCADE. Its self-editable
  -- line_user_id is not proof of ownership: only this link's user_id binds it
  -- to the retiring account. Other accounts' links and ambiguous NULL-user
  -- legacy follower rows remain; no LINE provider unlink is performed.
  PERFORM 1 FROM public.profiles p WHERE p.id=OLD.id FOR UPDATE;
  DELETE FROM public.line_user_links l WHERE l.user_id=OLD.id;
  DELETE FROM public.favorites WHERE user_id=OLD.id;
  DELETE FROM public.user_points WHERE user_id=OLD.id;
  DELETE FROM public.push_subscriptions WHERE user_id=OLD.id;
  DELETE FROM public.referral_codes WHERE user_id=OLD.id;
  DELETE FROM public.review_helpful WHERE user_id=OLD.id;
  DELETE FROM public.user_preferred_staff WHERE user_id=OLD.id;
  DELETE FROM public.google_calendar_tokens WHERE user_id=OLD.id;
  DELETE FROM public.user_packages WHERE user_id=OLD.id;
  DELETE FROM public.user_subscriptions WHERE user_id=OLD.id;
  UPDATE public.intake_form_responses SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.nps_surveys SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.booking_waitlist SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.treatment_records SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.treatment_plans SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.newsletter_campaigns SET created_by=NULL WHERE created_by=OLD.id;
  UPDATE public.api_keys SET created_by=NULL WHERE created_by=OLD.id;
  -- 2026-10-23: the booking keeps its contact details and loses user_id via
  -- ON DELETE SET NULL, which made a retired member indistinguishable from a
  -- guest. Record the retirement (outside bookings, which shops can read) so
  -- scheduled mail is not sent to it.
  INSERT INTO public.booking_member_withdrawals(booking_id)
   SELECT b.id FROM public.bookings b WHERE b.user_id=OLD.id ON CONFLICT (booking_id) DO NOTHING;
  RETURN OLD;
END;
$$;
-- The definer privilege is needed solely by the fixed OLD.id cleanup when
-- Supabase's existing Auth role deletes its user. No callable app RPC or new
-- Auth table/schema privilege is exposed to anon/authenticated/service_role.
REVOKE ALL ON FUNCTION public.cleanup_deleting_account_personal_data() FROM PUBLIC,anon,authenticated,service_role;

-- 2. 候補一覧（本体は 20261013111506 と同一＋1 行）。
CREATE OR REPLACE FUNCTION public.list_scheduled_review_recipients(p_after_updated_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS TABLE(id uuid,updated_at timestamptz) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR ((p_after_updated_at IS NULL)<>(p_after_id IS NULL)) THEN RAISE EXCEPTION 'REVIEW_PAGE_INVALID'; END IF;
 RETURN QUERY SELECT b.id,b.updated_at FROM public.bookings b WHERE b.status='completed'
  AND b.updated_at BETWEEN now()-interval '7 days' AND now()-interval '24 hours'
  AND b.review_request_legacy_claimed_at IS NULL AND b.review_request_provider_accepted_at IS NULL
  AND b.created_at>=public.scheduled_email_cutover_at()
  AND nullif(btrim(b.email),'') IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=b.facility_id AND f.status='published')
  AND (b.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=b.user_id AND p.email_unsubscribed IS NOT TRUE))
  AND NOT EXISTS(SELECT 1 FROM public.booking_member_withdrawals w WHERE w.booking_id=b.id) AND NOT public.email_address_opted_out(b.email)
  AND (p_after_id IS NULL OR (b.updated_at,b.id)>(p_after_updated_at,p_after_id))
  AND NOT EXISTS(SELECT 1 FROM public.scheduled_email_operations o WHERE o.kind='review_request' AND o.source_id=b.id AND o.period='once' AND o.published_at IS NOT NULL)
  ORDER BY b.updated_at,b.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_scheduled_review_recipients(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_scheduled_review_recipients(timestamptz,uuid,integer) TO service_role;

-- 3. 予約確保（本体は 20261013111506 と同一＋1 判定）。
CREATE OR REPLACE FUNCTION public.reserve_scheduled_email_atomic(p_kind text,p_source_id uuid,p_email text DEFAULT NULL)
RETURNS TABLE(state text,operation_id uuid,snapshot jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; p public.profiles%ROWTYPE;
 o public.scheduled_email_operations%ROWTYPE; v_period text; content jsonb; snap jsonb; token text; v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('review_request','favorites_digest') OR p_source_id IS NULL
  OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_INPUT_INVALID'; END IF;
 v_period:=CASE WHEN p_kind='review_request' THEN 'once' ELSE to_char(v_now AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW') END;
 -- Serialize receipt/queue publication WITHOUT changing the business source.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scheduled-email:'||p_kind||':'||p_source_id::text||':'||v_period,0));
 SELECT * INTO o FROM public.scheduled_email_operations e WHERE e.kind=p_kind AND e.source_id=p_source_id AND e.period=v_period;
 IF FOUND THEN RETURN QUERY SELECT CASE WHEN o.accepted_at IS NULL THEN 'reserved' ELSE 'accepted' END,o.id,o.snapshot; RETURN; END IF;
 IF p_kind='review_request' THEN
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_source_id;
  IF NOT FOUND OR b.status<>'completed' OR b.updated_at IS NULL OR b.updated_at>v_now-interval '24 hours'
    OR b.updated_at<v_now-interval '7 days' OR nullif(btrim(b.email),'') IS NULL THEN
   RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN;
  END IF;
  IF b.review_request_legacy_claimed_at IS NOT NULL THEN RETURN QUERY SELECT 'legacy_uncertain'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF b.created_at<public.scheduled_email_cutover_at() THEN RETURN QUERY SELECT 'legacy_uncertain'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF b.review_request_provider_accepted_at IS NOT NULL THEN RETURN QUERY SELECT 'accepted'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND OR f.status<>'published' THEN RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF b.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=b.user_id AND pr.email_unsubscribed IS NOT TRUE) THEN
   RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_member_withdrawals w WHERE w.booking_id=b.id) OR public.email_address_opted_out(b.email) THEN
   RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN;
  END IF;
  snap:=jsonb_build_object('email',b.email,'customerName',b.customer_name,'facilityName',f.name,'facilitySlug',f.slug,
   'facilityId',b.facility_id,'bookingRevision',b.updated_at,'userId',b.user_id,'expiresAt',b.updated_at+interval '7 days');
 ELSE
  SELECT * INTO p FROM public.profiles WHERE profiles.id=p_source_id FOR SHARE;
  IF NOT FOUND OR p.email_unsubscribed IS DISTINCT FROM false THEN RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF p.favorites_digest_legacy_claimed_week=v_period THEN RETURN QUERY SELECT 'legacy_uncertain'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF v_period<=to_char(public.scheduled_email_cutover_at() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW') THEN
   RETURN QUERY SELECT 'legacy_uncertain'::text,NULL::uuid,NULL::jsonb; RETURN;
  END IF;
  IF p_email IS NULL OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'DIGEST_RECIPIENT_INVALID'; END IF;
  content:=public.scheduled_digest_content(p_source_id,v_now-interval '7 days');
  IF jsonb_array_length(content)=0 THEN RETURN QUERY SELECT 'not_eligible'::text,NULL::uuid,NULL::jsonb; RETURN; END IF;
  IF jsonb_array_length(content)>200 THEN RAISE EXCEPTION 'DIGEST_CONTENT_TOO_LARGE'; END IF;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.email_unsubscribe_tokens(token,user_id) VALUES(token,p_source_id);
  snap:=jsonb_build_object('email',p_email,'userId',p_source_id,'userName',p.display_name,'facilities',content,'unsubscribeToken',token,
   'since',v_now-interval '7 days','expiresAt',(date_trunc('week',v_now AT TIME ZONE 'Asia/Tokyo')+interval '7 days') AT TIME ZONE 'Asia/Tokyo');
 END IF;
 INSERT INTO public.scheduled_email_operations(kind,source_id,period,snapshot) VALUES(p_kind,p_source_id,v_period,snap) RETURNING * INTO o;
 RETURN QUERY SELECT 'reserved'::text,o.id,o.snapshot;
END $$;
REVOKE ALL ON FUNCTION public.reserve_scheduled_email_atomic(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_scheduled_email_atomic(text,uuid,text) TO service_role;

-- 4. 送信直前のフェンス（本体は 20261013123844 と同一＋1 条件）。既に積まれたジョブもここで止まる。
CREATE OR REPLACE FUNCTION public.start_scheduled_email_delivery(p_queue_id uuid,p_claimed_at timestamptz,p_recipient_current boolean)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.scheduled_email_operations%ROWTYPE; q public.webhook_retry_queue%ROWTYPE; b public.bookings%ROWTYPE;
 p public.profiles%ROWTYPE; valid boolean; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO o FROM public.scheduled_email_operations WHERE scheduled_email_operations.id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_OPERATION_NOT_FOUND'; END IF;
 IF o.kind='review_request' THEN
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=(o.snapshot->>'facilityId')::uuid FOR SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=o.source_id FOR SHARE;
  valid:=b.id IS NOT NULL AND b.status='completed' AND b.updated_at IS NOT DISTINCT FROM (o.snapshot->>'bookingRevision')::timestamptz
    AND b.facility_id IS NOT DISTINCT FROM (o.snapshot->>'facilityId')::uuid AND p_recipient_current IS TRUE
    AND b.email IS NOT DISTINCT FROM o.snapshot->>'email' AND b.user_id IS NOT DISTINCT FROM (o.snapshot->>'userId')::uuid
    AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=b.facility_id AND f.status='published')
    AND (b.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=b.user_id AND pr.email_unsubscribed IS NOT TRUE))
    AND NOT EXISTS(SELECT 1 FROM public.booking_member_withdrawals w WHERE w.booking_id=b.id) AND NOT public.email_address_opted_out(b.email);
 ELSE
  SELECT * INTO p FROM public.profiles WHERE profiles.id=o.source_id FOR SHARE;
  valid:=p.id IS NOT NULL AND p.email_unsubscribed IS NOT DISTINCT FROM false AND p_recipient_current IS TRUE
    AND EXISTS(SELECT 1 FROM public.email_unsubscribe_tokens t WHERE t.token=o.snapshot->>'unsubscribeToken' AND t.user_id=o.source_id)
    AND public.scheduled_digest_snapshot_valid(o.source_id,o.snapshot->'facilities',(o.snapshot->>'since')::timestamptz);
 END IF;
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
  RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN;
 END IF;
 IF q.payload->'scheduled_email_version' IS DISTINCT FROM '1'::jsonb OR q.payload->>'scheduled_kind' IS DISTINCT FROM o.kind
  OR q.target_id IS DISTINCT FROM o.snapshot->>'email' OR q.email_envelope IS NULL OR q.email_envelope->>'to' IS DISTINCT FROM q.target_id THEN
  RAISE EXCEPTION 'SCHEDULED_EMAIL_FENCE_INVALID';
 END IF;
 IF valid IS DISTINCT FROM true OR stamp>=(o.snapshot->>'expiresAt')::timestamptz THEN
  UPDATE public.webhook_retry_queue SET status='failed',processed_at=stamp,last_error='scheduled_email_superseded' WHERE webhook_retry_queue.id=q.id;
  RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
 END IF;
 UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE webhook_retry_queue.id=q.id;
 RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) TO service_role;
