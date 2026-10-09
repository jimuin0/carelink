-- Admin newsletter operations are separate from the period newsletter_send_log.
ALTER TABLE public.webhook_retry_queue DROP CONSTRAINT event_email_envelope_shape;
ALTER TABLE public.webhook_retry_queue ADD CONSTRAINT event_email_envelope_shape CHECK (
 email_envelope IS NULL OR (jsonb_typeof(email_envelope)='object'
 AND email_envelope ?& ARRAY['from','to','subject','html']
 AND email_envelope-ARRAY['from','to','subject','html','text']='{}'::jsonb
 AND jsonb_typeof(email_envelope->'from')='string' AND jsonb_typeof(email_envelope->'to')='string'
 AND jsonb_typeof(email_envelope->'subject')='string' AND jsonb_typeof(email_envelope->'html')='string'
 AND (NOT(email_envelope?'text') OR (jsonb_typeof(email_envelope->'text')='string' AND char_length(email_envelope->>'text')<=100000))));
-- Per-email dispatch checks need exact mailbox normalization, without Gmail
-- alias collapsing used by unrelated customer identity helpers.
CREATE INDEX newsletter_profiles_mailbox ON public.profiles((lower(btrim(email))));
CREATE INDEX newsletter_subscriptions_mailbox ON public.newsletter_subscriptions((lower(btrim(email))));

CREATE TABLE public.newsletter_send_operations(
 operation_id uuid PRIMARY KEY,campaign_id uuid NOT NULL UNIQUE REFERENCES public.newsletter_campaigns(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,campaign_revision timestamptz NOT NULL,campaign_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.newsletter_send_recipients(
 recipient_id uuid PRIMARY KEY,operation_id uuid NOT NULL REFERENCES public.newsletter_send_operations(operation_id) ON DELETE RESTRICT,
 queue_id uuid NOT NULL UNIQUE REFERENCES public.webhook_retry_queue(id) ON DELETE RESTRICT,
 start_claimed_at timestamptz,start_time timestamptz,rejected_retry_authorized boolean NOT NULL DEFAULT false,
 suppressed_authorized boolean NOT NULL DEFAULT false,email text NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','unconfirmed','accepted','suppressed','failed')),
 UNIQUE(operation_id,email));
ALTER TABLE public.newsletter_send_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_send_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_send_operations,public.newsletter_send_recipients FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.newsletter_send_operations,public.newsletter_send_recipients TO service_role;

CREATE FUNCTION public.newsletter_current_recipients(p_kind text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
  SELECT lower(btrim(s.email)) email FROM public.newsletter_subscriptions s WHERE s.is_active
   AND s.email IS NOT NULL AND s.subscription_type IN (CASE WHEN p_kind='owner_monthly' THEN 'owner_monthly' ELSE 'user_digest' END,'all')
  UNION
  SELECT lower(btrim(p.email)) FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
   WHERE p_kind='owner_monthly' AND m.role='owner' AND p.email IS NOT NULL
 ) SELECT DISTINCT c.email FROM candidates c WHERE c.email<>''
 AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.email_unsubscribed AND lower(btrim(p.email))=c.email)
 AND NOT EXISTS(SELECT 1 FROM public.newsletter_subscriptions s WHERE NOT s.is_active AND lower(btrim(s.email))=c.email)
 ORDER BY c.email;
$$;
REVOKE ALL ON FUNCTION public.newsletter_current_recipients(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_current_recipients(text) TO service_role;

CREATE FUNCTION public.newsletter_operation_receipt(p_campaign_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('operation_id',o.operation_id,'campaign_id',o.campaign_id,
  'total',count(r.recipient_id),'queued',count(*)FILTER(WHERE r.state='queued'),
  'unconfirmed',count(*)FILTER(WHERE r.state='unconfirmed'),'accepted',count(*)FILTER(WHERE r.state='accepted'),
  'suppressed',count(*)FILTER(WHERE r.state='suppressed'),'failed',count(*)FILTER(WHERE r.state='failed'))
 FROM public.newsletter_send_operations o LEFT JOIN public.newsletter_send_recipients r ON r.operation_id=o.operation_id
 WHERE o.campaign_id=p_campaign_id GROUP BY o.operation_id,o.campaign_id;
$$;
REVOKE ALL ON FUNCTION public.newsletter_operation_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.inspect_newsletter_send_operation(p_actor_id uuid,p_campaign_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_PLATFORM_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN public.newsletter_operation_receipt(p_campaign_id);
END $$;

CREATE FUNCTION public.publish_newsletter_send_operation(p_actor_id uuid,p_campaign_id uuid,p_expected_revision timestamptz,
 p_expected_emails text[],p_unsubscribe_links jsonb,p_from text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.newsletter_campaigns%ROWTYPE; actual text[]; expected text[]; op uuid; recipient uuid; q uuid;
 address text; link text; envelope jsonb; existing jsonb;
BEGIN
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_PLATFORM_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.newsletter_campaigns WHERE id=p_campaign_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_CAMPAIGN_NOT_FOUND'; END IF;
 existing:=public.newsletter_operation_receipt(p_campaign_id);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 -- A pinned new API may run while migrations are only partly applied. Old
 -- workers must already be fenced before any new V2 queue is published.
 IF to_regprocedure('public.webhook_dispatch_v2_version()') IS NULL THEN
  RAISE EXCEPTION 'NEWSLETTER_DISPATCH_UNAVAILABLE'; END IF;
 IF public.webhook_dispatch_v2_version() IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'NEWSLETTER_DISPATCH_UNAVAILABLE'; END IF;
 IF c.status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'NEWSLETTER_LEGACY_OR_ALREADY_SENT' USING ERRCODE='23514'; END IF;
 IF c.updated_at IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'NEWSLETTER_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(email ORDER BY email),'{}') INTO actual FROM public.newsletter_current_recipients(c.campaign_type) email;
 SELECT coalesce(array_agg(email ORDER BY email),'{}') INTO expected FROM unnest(p_expected_emails) email;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'NEWSLETTER_AUDIENCE_CONFLICT' USING ERRCODE='40001'; END IF;
 IF cardinality(actual)=0 THEN RAISE EXCEPTION 'NEWSLETTER_NO_RECIPIENTS' USING ERRCODE='23514'; END IF;
 IF p_from IS NULL OR p_from='' OR p_from~E'[\\r\\n\\t]' OR char_length(p_from)>320 OR jsonb_typeof(p_unsubscribe_links)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_unsubscribe_links))<>cardinality(actual) THEN RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
 op:=pg_catalog.gen_random_uuid();
 INSERT INTO public.newsletter_send_operations(operation_id,campaign_id,actor_id,campaign_revision,campaign_snapshot)
 VALUES(op,c.id,p_actor_id,c.updated_at,jsonb_build_object('campaign_type',c.campaign_type,'subject',c.subject,
  'html_content',c.html_content,'text_content',c.text_content,'target_segment',c.target_segment));
 FOREACH address IN ARRAY actual LOOP
  link:=p_unsubscribe_links->>address;
  IF address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(address)>254
   OR link IS NULL OR char_length(link)>1024 OR link !~ '^https://[^[:space:]"<>]+/unsubscribe\?n=[A-Za-z0-9_-]{20,}$' THEN
    RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
  envelope:=jsonb_build_object('from',p_from,'to',address,'subject',left(translate(c.subject,E'\r\n\t','   '),200),
   'html',c.html_content||'<br><br><hr><p style="font-size:11px;color:#999">配信停止は<a href="'||link||'">こちら</a></p>');
  IF c.text_content IS NOT NULL AND c.text_content<>'' THEN
   envelope:=envelope||jsonb_build_object('text',c.text_content||E'\n\n配信停止: '||link);
  END IF;
  IF char_length(envelope->>'html')>100000 OR char_length(envelope->>'subject')=0
   OR (envelope?'text' AND char_length(envelope->>'text')>100000) THEN RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
  recipient:=pg_catalog.gen_random_uuid();q:=pg_catalog.gen_random_uuid();
  INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,payload,email_envelope,status,attempt_count,max_attempts,scheduled_at)
  VALUES(q,'email',address,jsonb_build_object('event_email_version',1,'idempotency_key','carelink-event-email/'||q::text,
   'newsletter_delivery_version',1,'dispatch_version',2,'campaign_id',c.id,'newsletter_operation_id',op,'newsletter_recipient_id',recipient),envelope,'pending',0,3,clock_timestamp());
  INSERT INTO public.newsletter_send_recipients(recipient_id,operation_id,queue_id,email) VALUES(recipient,op,q,address);
 END LOOP;
 UPDATE public.newsletter_campaigns SET status='sending',stats=jsonb_build_object('delivery_mode','newsletter_outbox_v1','operation_id',op,
  'total',cardinality(actual),'queued',cardinality(actual),'accepted',0,'suppressed',0,'failed',0,'unconfirmed',0,'sent',0,'opened',0,'clicked',0,'bounced',0),updated_at=clock_timestamp() WHERE id=c.id;
 RETURN public.newsletter_operation_receipt(c.id);
END $$;

CREATE FUNCTION public.start_newsletter_delivery(p_queue_id uuid,p_claimed_at timestamptz)
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
 FOR account IN SELECT id FROM public.profiles WHERE lower(btrim(email))=r.email ORDER BY id LOOP
  PERFORM public.lock_booking_account(account);
 END LOOP;
 PERFORM 1 FROM public.profiles WHERE lower(btrim(email))=r.email ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
  WHERE lower(btrim(p.email))=r.email ORDER BY m.id FOR SHARE OF m;
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

-- Only the new worker may release a started delivery after an explicit provider
-- rejection. Timeouts/missing IDs/uncertain writes never use this RPC.
CREATE FUNCTION public.authorize_newsletter_rejected_retry(p_queue_id uuid,p_claimed_at timestamptz,p_started_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE;
BEGIN
 SELECT * INTO q FROM public.webhook_retry_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at
  OR q.delivery_started_at IS NULL OR q.delivery_started_at IS DISTINCT FROM p_started_at THEN RETURN false; END IF;
 UPDATE public.newsletter_send_recipients SET rejected_retry_authorized=true WHERE queue_id=q.id
  AND start_claimed_at=p_claimed_at AND start_time=p_started_at AND state='unconfirmed';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.authorize_newsletter_rejected_retry(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_newsletter_rejected_retry(uuid,timestamptz,timestamptz) TO service_role;
CREATE FUNCTION public.guard_newsletter_queue_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.newsletter_send_recipients%ROWTYPE;
BEGIN
 IF OLD.payload->>'newsletter_delivery_version' IS DISTINCT FROM '1' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.newsletter_send_recipients WHERE queue_id=OLD.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_RECIPIENT_REQUIRED'; END IF;
 IF OLD.status='success' OR r.state='suppressed' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'NEWSLETTER_DELIVERY_TERMINAL'; END IF;
 END IF;
 IF NEW.delivery_started_at IS NOT NULL AND
  (NEW.delivery_started_at IS DISTINCT FROM r.start_time OR NEW.claimed_at IS DISTINCT FROM r.start_claimed_at) THEN
  RAISE EXCEPTION 'NEWSLETTER_START_PROOF_REQUIRED' USING ERRCODE='42501'; END IF;
 IF OLD.delivery_started_at IS NOT NULL AND NEW.delivery_started_at IS NOT NULL AND NEW.status NOT IN ('processing','success') THEN
  RAISE EXCEPTION 'NEWSLETTER_UNKNOWN_RETRY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF OLD.delivery_started_at IS NOT NULL AND NEW.delivery_started_at IS NULL AND
  (NOT r.rejected_retry_authorized OR OLD.status<>'processing' OR NEW.status NOT IN ('pending','failed')
   OR NEW.attempt_count<>OLD.attempt_count+1
   OR (NEW.status='pending' AND (NEW.claimed_at IS NOT NULL OR NEW.scheduled_at<=OLD.scheduled_at))
   OR (NEW.status='failed' AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at)) THEN
  RAISE EXCEPTION 'NEWSLETTER_UNKNOWN_RETRY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NEW.last_error='newsletter_suppressed' AND NOT r.suppressed_authorized THEN
  RAISE EXCEPTION 'NEWSLETTER_SUPPRESSION_PROOF_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NEW.status='success' AND (NEW.delivery_started_at IS NULL OR NEW.provider_message_id IS NULL OR NEW.delivered_at IS NULL) THEN
  RAISE EXCEPTION 'NEWSLETTER_ACCEPTANCE_UNVERIFIED'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_newsletter_queue_delivery() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_newsletter_queue_delivery BEFORE UPDATE ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION public.guard_newsletter_queue_delivery();

CREATE FUNCTION public.sync_newsletter_delivery_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.newsletter_send_recipients%ROWTYPE; cid uuid; summary jsonb;
BEGIN
 IF NEW.payload->>'newsletter_delivery_version' IS DISTINCT FROM '1' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.newsletter_send_recipients WHERE queue_id=NEW.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_RECIPIENT_REQUIRED'; END IF;
 IF NEW.status='success' AND (NEW.provider_message_id IS NULL OR NEW.delivered_at IS NULL OR NEW.delivery_started_at IS NULL) THEN
  RAISE EXCEPTION 'NEWSLETTER_ACCEPTANCE_UNVERIFIED'; END IF;
 UPDATE public.newsletter_send_recipients SET state=CASE WHEN NEW.status='success' THEN 'accepted'
  WHEN NEW.last_error='newsletter_suppressed' AND NEW.delivery_started_at IS NULL THEN 'suppressed'
  WHEN NEW.delivery_started_at IS NOT NULL THEN 'unconfirmed' WHEN NEW.status IN ('failed','cancelled') THEN 'failed' ELSE 'queued' END
 ,start_claimed_at=CASE WHEN NEW.delivery_started_at IS NULL THEN NULL ELSE start_claimed_at END,
 start_time=CASE WHEN NEW.delivery_started_at IS NULL THEN NULL ELSE start_time END,rejected_retry_authorized=false
 WHERE recipient_id=r.recipient_id;
 SELECT campaign_id INTO cid FROM public.newsletter_send_operations WHERE operation_id=r.operation_id;
 -- Serialize summary recomputation after the campaign lock, avoiding stale counts
 -- when different recipient workers finish concurrently.
 PERFORM 1 FROM public.newsletter_campaigns WHERE id=cid FOR UPDATE;
 summary:=public.newsletter_operation_receipt(cid);
 UPDATE public.newsletter_campaigns SET stats=summary||jsonb_build_object('delivery_mode','newsletter_outbox_v1','sent',(summary->>'accepted')::int,'opened',0,'clicked',0,'bounced',(summary->>'failed')::int),
  status=CASE WHEN (summary->>'total')::int>0 AND (summary->>'accepted')::int+(summary->>'suppressed')::int=(summary->>'total')::int THEN 'sent' ELSE 'sending' END,
  sent_at=CASE WHEN (summary->>'total')::int>0 AND (summary->>'accepted')::int+(summary->>'suppressed')::int=(summary->>'total')::int THEN clock_timestamp() ELSE NULL END,
  updated_at=clock_timestamp() WHERE id=cid;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_newsletter_delivery_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_newsletter_delivery_state AFTER UPDATE ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION public.sync_newsletter_delivery_state();
CREATE FUNCTION public.guard_newsletter_send_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; current_campaign public.newsletter_campaigns%ROWTYPE; complete boolean; key text;
BEGIN
 receipt:=public.newsletter_operation_receipt(NEW.id);
 IF NEW.status='sending' AND receipt IS NULL THEN
  RAISE EXCEPTION 'NEWSLETTER_OPERATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND receipt IS NULL AND NEW.status='sent' AND OLD.status<>'sent' THEN
  RAISE EXCEPTION 'NEWSLETTER_OPERATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND receipt IS NOT NULL AND
  (NEW.campaign_type IS DISTINCT FROM OLD.campaign_type OR NEW.subject IS DISTINCT FROM OLD.subject
   OR NEW.html_content IS DISTINCT FROM OLD.html_content OR NEW.text_content IS DISTINCT FROM OLD.text_content
   OR NEW.target_segment IS DISTINCT FROM OLD.target_segment OR NEW.status IN ('draft','scheduled','cancelled')) THEN
  RAISE EXCEPTION 'NEWSLETTER_PUBLISHED_OPERATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF receipt IS NOT NULL THEN
  -- Deferred events may describe earlier states in the same transaction. Verify
  -- the final row against the final ledger rather than an earlier event image.
  SELECT * INTO current_campaign FROM public.newsletter_campaigns WHERE id=NEW.id;
  complete:=(receipt->>'accepted')::int+(receipt->>'suppressed')::int=(receipt->>'total')::int;
  IF current_campaign.status IS DISTINCT FROM (CASE WHEN complete THEN 'sent' ELSE 'sending' END)
   OR current_campaign.stats->>'delivery_mode' IS DISTINCT FROM 'newsletter_outbox_v1' THEN
   RAISE EXCEPTION 'NEWSLETTER_LEDGER_STATE_MISMATCH' USING ERRCODE='23514'; END IF;
  FOREACH key IN ARRAY ARRAY['operation_id','total','queued','unconfirmed','accepted','suppressed','failed'] LOOP
   IF current_campaign.stats->key IS DISTINCT FROM receipt->key THEN
    RAISE EXCEPTION 'NEWSLETTER_LEDGER_STATE_MISMATCH' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guard_newsletter_send_operation() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER guard_newsletter_send_operation AFTER INSERT OR UPDATE ON public.newsletter_campaigns
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_newsletter_send_operation();
REVOKE ALL ON FUNCTION public.inspect_newsletter_send_operation(uuid,uuid),public.publish_newsletter_send_operation(uuid,uuid,timestamptz,text[],jsonb,text),public.start_newsletter_delivery(uuid,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_newsletter_send_operation(uuid,uuid),public.publish_newsletter_send_operation(uuid,uuid,timestamptz,text[],jsonb,text),public.start_newsletter_delivery(uuid,timestamptz) TO service_role;

-- Preserve durable newsletter receipts; pruning them would reopen lost-response
-- retries. Existing unrelated queue retention remains unchanged.
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_retry() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 DELETE FROM public.webhook_retry_queue q WHERE q.status IN ('success','failed','cancelled')
  AND q.created_at<now()-interval '7 days'
  AND NOT EXISTS(SELECT 1 FROM public.newsletter_send_recipients r WHERE r.queue_id=q.id);
END $$;

-- The application has no browser-side subscription writer. Keep owned reads,
-- while verified service producers and signed unsubscribe retain their path.
DROP POLICY IF EXISTS newsletter_subs_own ON public.newsletter_subscriptions;
CREATE POLICY newsletter_subs_own_read ON public.newsletter_subscriptions FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON public.newsletter_subscriptions FROM anon,authenticated;
GRANT SELECT ON public.newsletter_subscriptions TO authenticated;

-- Signed URL verification remains in the server. Token lookup and all durable
-- suppression/consumption writes now form one service-only transaction.
DROP POLICY IF EXISTS anon_read_token ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS anon_update_token ON public.email_unsubscribe_tokens;
REVOKE ALL ON public.email_unsubscribe_tokens FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.unsubscribe_newsletter_atomic(p_email text,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text; uid uuid; account uuid; token_row public.email_unsubscribe_tokens%ROWTYPE; was_stopped boolean;
BEGIN
 IF (p_email IS NULL)=(p_token IS NULL) THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 IF p_token IS NOT NULL THEN
  IF p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
  uid:=token_row.user_id;
  SELECT lower(btrim(coalesce(p.email,u.email))) INTO address FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid;
  IF address IS NULL OR address='' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_UNAVAILABLE'; END IF;
 ELSE address:=lower(btrim(p_email)); END IF;
 IF address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(address)>254 THEN
  RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 FOR account IN SELECT id FROM public.profiles WHERE lower(btrim(email))=address OR id=uid ORDER BY id LOOP
  PERFORM public.lock_booking_account(account);
 END LOOP;
 PERFORM 1 FROM public.profiles WHERE lower(btrim(email))=address OR id=uid ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address ORDER BY id FOR UPDATE;
 IF p_token IS NOT NULL THEN
  IF address IS DISTINCT FROM (SELECT lower(btrim(coalesce(p.email,u.email))) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid) THEN
   RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_CHANGED' USING ERRCODE='40001'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_TOKEN_CHANGED' USING ERRCODE='40001'; END IF;
  IF token_row.used_at IS NOT NULL THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
 END IF;
 was_stopped:=EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address AND NOT is_active);
 UPDATE public.profiles SET email_unsubscribed=true WHERE lower(btrim(email))=address OR id=uid;
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
