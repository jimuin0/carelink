-- Durable private LINE support. No sends, customer updates, or activation here.
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'CareLink database required';
  END IF;
END $guard$;

CREATE TABLE public.line_support_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  rollout text NOT NULL DEFAULT 'observe' CHECK(rollout IN ('off','observe','live')),
  operator_id uuid REFERENCES public.profiles(id),
  recipient_id text CHECK(recipient_id ~ '^U[0-9a-f]{32}$'),
  recipient_version integer NOT NULL DEFAULT 0 CHECK(recipient_version >= 0),
  recipient_verified boolean NOT NULL DEFAULT false,
  pair_hash text CHECK(pair_hash ~ '^[0-9a-f]{64}$'),
  pair_actor uuid REFERENCES public.profiles(id),
  pair_expires_at timestamptz,
  pair_candidate text CHECK(pair_candidate ~ '^U[0-9a-f]{32}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT recipient_verified OR (operator_id IS NOT NULL AND recipient_id IS NOT NULL))
);
INSERT INTO public.line_support_settings(singleton) VALUES(true);

CREATE TABLE public.line_support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL UNIQUE CHECK(line_user_id ~ '^U[0-9a-f]{32}$'),
  mode text NOT NULL DEFAULT 'automatic' CHECK(mode IN ('automatic','human','closed')),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision >= 0),
  blocked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.line_support_events (
  event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 128),
  conversation_id uuid NOT NULL REFERENCES public.line_support_conversations(id),
  revision bigint NOT NULL,
  message_id text CHECK(length(message_id) <= 128),
  message_type text NOT NULL CHECK(message_type IN ('text','image','file','audio','video','sticker','location','unfollow','unsend','follow')),
  body text NOT NULL CHECK(length(body) <= 5000),
  raw_message jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(raw_message)='object'),
  send_allowed_at_receipt boolean NOT NULL DEFAULT false,
  reply_token text CHECK(length(reply_token) BETWEEN 1 AND 2048),
  reply_expires_at timestamptz,
  reply_fallback_reason text CHECK(reply_fallback_reason IN ('expired','failed','unknown','policy')),
  withdrawn boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','done','superseded')),
  lease_id uuid,
  lease_until timestamptz,
  UNIQUE(conversation_id, revision)
);
CREATE INDEX line_support_events_pending ON public.line_support_events(state, received_at);
CREATE TABLE public.line_support_drafts (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.line_support_conversations(id),
  conversation_revision bigint NOT NULL,
  knowledge_revision text NOT NULL CHECK(knowledge_revision ~ '^[0-9a-f]{64}$'),
  model_version text NOT NULL CHECK(length(model_version) BETWEEN 1 AND 150),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX line_support_drafts_history ON public.line_support_drafts(conversation_id,conversation_revision);
CREATE TABLE public.line_support_deliveries (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.line_support_conversations(id),
  conversation_revision bigint NOT NULL,
  knowledge_revision text NOT NULL CHECK(knowledge_revision ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK(kind IN ('customer_reply','operator_draft')),
  draft_id uuid REFERENCES public.line_support_drafts(id),
  recipient_id text NOT NULL CHECK(recipient_id ~ '^U[0-9a-f]{32}$'),
  recipient_version integer NOT NULL,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','unknown','failed','superseded')),
  retry_key uuid NOT NULL UNIQUE,
  proposal_body text CHECK(length(proposal_body) BETWEEN 1 AND 2400),
  reply_token text CHECK(length(reply_token) BETWEEN 1 AND 2048),
  reply_expires_at timestamptz,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  provider_request_id text CHECK(length(provider_request_id) <= 128),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='operator_draft') = (draft_id IS NOT NULL)),
  CHECK((kind='operator_draft') = (proposal_body IS NOT NULL)),
  CHECK((kind='customer_reply' AND reply_token IS NOT NULL AND reply_expires_at IS NOT NULL)
    OR (kind='operator_draft' AND reply_token IS NULL AND reply_expires_at IS NULL))
);
CREATE UNIQUE INDEX line_support_deliveries_active ON public.line_support_deliveries(conversation_id,conversation_revision,kind) WHERE state<>'superseded';
CREATE INDEX line_support_deliveries_pending ON public.line_support_deliveries(state, created_at);

DO $permissions$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['line_support_settings','line_support_conversations','line_support_events','line_support_drafts','line_support_deliveries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  END LOOP;
END $permissions$;

-- Service-only ingress. The application MUST verify the raw LINE signature first.
CREATE FUNCTION public.accept_line_support_event(p_event_id text,p_line_user_id text,p_message_type text,p_message_id text,p_body text,p_occurred_at timestamptz,p_requires_human boolean DEFAULT true,p_raw_message jsonb DEFAULT '{}'::jsonb,p_reply_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.line_support_conversations; e public.line_support_events; s public.line_support_settings;
BEGIN
  SELECT * INTO s FROM public.line_support_settings WHERE singleton FOR UPDATE;
  IF s.rollout='off' THEN RETURN jsonb_build_object('status','disabled'); END IF;
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 128
     OR p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$'
     OR p_message_type IS NULL OR p_message_type NOT IN ('text','image','file','audio','video','sticker','location','unfollow','unsend','follow')
     OR p_body IS NULL OR length(p_body)>5000 OR p_occurred_at IS NULL
     OR p_raw_message IS NULL OR jsonb_typeof(p_raw_message)<>'object'
     OR (p_reply_token IS NOT NULL AND length(p_reply_token) NOT BETWEEN 1 AND 2048) THEN
    RAISE EXCEPTION 'Invalid support event' USING ERRCODE='22023';
  END IF;
  SELECT * INTO e FROM public.line_support_events WHERE event_id=p_event_id;
  IF FOUND THEN
    SELECT * INTO c FROM public.line_support_conversations WHERE id=e.conversation_id;
    IF c.line_user_id <> p_line_user_id OR e.message_type <> p_message_type OR e.body <> p_body
       OR e.message_id IS DISTINCT FROM p_message_id OR e.occurred_at <> p_occurred_at OR e.raw_message<>p_raw_message THEN
      RAISE EXCEPTION 'Event identity conflict' USING ERRCODE='23505';
    END IF;
    IF e.state='pending' AND p_reply_token IS NOT NULL THEN
      UPDATE public.line_support_events SET reply_token=p_reply_token,reply_expires_at=now()+interval '40 seconds' WHERE event_id=p_event_id;
    END IF;
    RETURN jsonb_build_object('status','duplicate','conversation_id',c.id,'revision',e.revision);
  END IF;
  INSERT INTO public.line_support_conversations(line_user_id) VALUES(p_line_user_id)
    ON CONFLICT(line_user_id) DO NOTHING;
  SELECT * INTO c FROM public.line_support_conversations WHERE line_user_id=p_line_user_id FOR UPDATE;
  UPDATE public.line_support_conversations SET revision=revision+1,
    mode=CASE WHEN p_requires_human IS DISTINCT FROM false OR p_message_type IN ('unfollow','unsend')
      OR EXISTS(SELECT 1 FROM public.line_support_events prior WHERE prior.conversation_id=c.id AND prior.revision=c.revision
        AND (prior.state IN ('pending','processing') OR EXISTS(SELECT 1 FROM public.line_support_deliveries d
          WHERE d.conversation_id=c.id AND d.conversation_revision=prior.revision AND d.state IN ('pending','sending','failed','unknown')))) OR p_occurred_at <
      COALESCE((SELECT max(occurred_at) FROM public.line_support_events WHERE conversation_id=c.id),p_occurred_at)
      THEN 'human' WHEN mode='closed' THEN 'human' ELSE mode END,
    blocked=CASE WHEN p_message_type='unfollow' THEN true WHEN p_message_type='follow' AND p_occurred_at >= COALESCE((SELECT max(occurred_at) FROM public.line_support_events WHERE conversation_id=c.id),p_occurred_at) THEN false ELSE blocked END, updated_at=now()
    WHERE id=c.id RETURNING * INTO c;
  UPDATE public.line_support_events SET state='superseded',lease_id=NULL,lease_until=NULL
    WHERE conversation_id=c.id AND state IN ('pending','processing');
  UPDATE public.line_support_deliveries SET state='superseded'
    WHERE conversation_id=c.id AND state='pending';
  INSERT INTO public.line_support_events(event_id,conversation_id,revision,message_id,message_type,body,occurred_at,raw_message,send_allowed_at_receipt,reply_token,reply_expires_at)
    VALUES(p_event_id,c.id,c.revision,p_message_id,p_message_type,p_body,p_occurred_at,p_raw_message,s.rollout='live',p_reply_token,
      CASE WHEN p_reply_token IS NOT NULL THEN now()+interval '40 seconds' ELSE NULL END);
  IF p_message_type='unsend' THEN
    UPDATE public.line_support_events SET withdrawn=true WHERE conversation_id=c.id
      AND message_id=p_message_id AND event_id<>p_event_id;
  END IF;
  RETURN jsonb_build_object('status','accepted','conversation_id',c.id,'revision',c.revision);
END $fn$;

-- Event lease prevents overlapping model generation; a restarted worker may reclaim an expired lease.
CREATE FUNCTION public.accept_line_support_events(p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE e jsonb; receipt jsonb; receipts jsonb:='[]'::jsonb;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>100 THEN
    RAISE EXCEPTION 'Invalid support batch' USING ERRCODE='22023';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    receipt:=public.accept_line_support_event(e->>'event_id',e->>'line_user_id',e->>'message_type',e->>'message_id',e->>'body',
      (e->>'occurred_at')::timestamptz,COALESCE((e->>'requires_human')::boolean,true),COALESCE(e->'raw_message','{}'::jsonb),e->>'reply_token');
    receipts:=receipts||jsonb_build_array(receipt||jsonb_build_object('event_id',e->>'event_id'));
  END LOOP;
  RETURN receipts;
END $fn$;
REVOKE ALL ON FUNCTION public.accept_line_support_events(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_line_support_events(jsonb) TO service_role;

CREATE FUNCTION public.claim_line_support_event(p_event_id text,p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE e public.line_support_events; c public.line_support_conversations;
BEGIN
  IF p_lease_id IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.line_support_settings WHERE singleton AND rollout<>'off' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.line_support_events WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.line_support_conversations WHERE id=e.conversation_id FOR UPDATE;
  IF e.revision<>c.revision OR c.blocked OR e.message_type IN ('unfollow','unsend','follow') THEN
    UPDATE public.line_support_events SET state='superseded' WHERE event_id=p_event_id;
    RETURN NULL;
  END IF;
  IF e.state IN ('done','superseded') OR (e.state='processing' AND e.lease_until>now()) THEN RETURN NULL; END IF;
  UPDATE public.line_support_events SET state='processing',lease_id=p_lease_id,lease_until=now()+interval '90 seconds'
    WHERE event_id=p_event_id RETURNING * INTO e;
  RETURN jsonb_build_object('event',to_jsonb(e),'mode',c.mode);
END $fn$;

CREATE FUNCTION public.prepare_line_support_delivery(p_event_id text,p_lease_id uuid,p_delivery_id uuid,p_retry_key uuid,p_kind text,p_knowledge_revision text,p_body text,p_model_version text,p_proposal_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.line_support_settings; e public.line_support_events; c public.line_support_conversations;
  d public.line_support_deliveries; draft_id uuid;
BEGIN
  SELECT * INTO s FROM public.line_support_settings WHERE singleton FOR UPDATE;
  SELECT * INTO e FROM public.line_support_events WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','stale'); END IF;
  SELECT * INTO c FROM public.line_support_conversations WHERE id=e.conversation_id FOR UPDATE;
  IF e.state<>'processing' OR e.lease_id IS DISTINCT FROM p_lease_id OR e.lease_until<=now()
     OR c.revision<>e.revision OR c.blocked THEN RETURN jsonb_build_object('status','stale'); END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('customer_reply','operator_draft') THEN
    RAISE EXCEPTION 'Invalid delivery kind' USING ERRCODE='22023';
  END IF;
  IF (p_kind='operator_draft' AND (COALESCE(p_proposal_text,p_body) IS NULL OR length(COALESCE(p_proposal_text,p_body)) NOT BETWEEN 1 AND 2400))
     OR (p_kind='customer_reply' AND p_proposal_text IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid copyable proposal' USING ERRCODE='22023'; END IF;
  IF p_kind='customer_reply' AND c.mode<>'automatic' THEN RETURN jsonb_build_object('status','human'); END IF;
  IF p_kind='customer_reply' AND (e.reply_token IS NULL OR e.reply_expires_at<=now()+interval '5 seconds') THEN
    RETURN jsonb_build_object('status','reply_expired'); END IF;
  IF p_kind='operator_draft' THEN
    draft_id:=p_delivery_id;
    INSERT INTO public.line_support_drafts(id,conversation_id,conversation_revision,knowledge_revision,body,model_version)
      VALUES(draft_id,c.id,c.revision,p_knowledge_revision,COALESCE(p_proposal_text,p_body),p_model_version);
    UPDATE public.line_support_conversations SET mode='human' WHERE id=c.id;
  END IF;
  -- Save the draft even before a recipient is bound. Never pretend it was notified.
  IF p_kind='operator_draft' AND NOT s.recipient_verified THEN
    UPDATE public.line_support_events SET state='done',lease_id=NULL,lease_until=NULL WHERE event_id=p_event_id;
    RETURN jsonb_build_object('status','recipient_unbound','draft_id',draft_id);
  END IF;
  INSERT INTO public.line_support_deliveries(id,conversation_id,conversation_revision,knowledge_revision,kind,draft_id,recipient_id,recipient_version,body,retry_key,proposal_body,state,reply_token,reply_expires_at)
    VALUES(p_delivery_id,c.id,c.revision,p_knowledge_revision,p_kind,draft_id,
      CASE WHEN p_kind='operator_draft' THEN s.recipient_id ELSE c.line_user_id END,
      s.recipient_version,p_body,p_retry_key,CASE WHEN p_kind='operator_draft' THEN COALESCE(p_proposal_text,p_body) ELSE NULL END,
      CASE WHEN s.rollout='live' AND e.send_allowed_at_receipt THEN 'pending' ELSE 'superseded' END,
      CASE WHEN p_kind='customer_reply' THEN e.reply_token ELSE NULL END,CASE WHEN p_kind='customer_reply' THEN e.reply_expires_at ELSE NULL END) RETURNING * INTO d;
  UPDATE public.line_support_events SET state='done',lease_id=NULL,lease_until=NULL WHERE event_id=p_event_id;
  RETURN jsonb_build_object('status',CASE WHEN d.state='pending' THEN 'prepared' ELSE 'observed' END,'delivery_id',d.id);
END $fn$;

-- No automatic resend after a possible external side effect. Stable key is persisted before first attempt.
CREATE FUNCTION public.claim_line_support_delivery(p_delivery_id uuid,p_knowledge_revision text,p_expected_reply text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.line_support_settings; c public.line_support_conversations; d public.line_support_deliveries; operator_allowed boolean:=true;
BEGIN
  SELECT * INTO s FROM public.line_support_settings WHERE singleton FOR UPDATE;
  SELECT * INTO d FROM public.line_support_deliveries WHERE id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'pending' THEN RETURN NULL; END IF;
  IF s.rollout<>'live' THEN RETURN NULL; END IF;
  IF d.kind='operator_draft' THEN
    PERFORM 1 FROM public.profiles WHERE id=s.operator_id AND is_platform_admin=true FOR SHARE;
    operator_allowed:=FOUND;
  END IF;
  SELECT * INTO c FROM public.line_support_conversations WHERE id=d.conversation_id FOR UPDATE;
  IF c.blocked OR c.revision<>d.conversation_revision
     OR (d.kind='customer_reply' AND c.mode<>'automatic')
     OR (d.kind='operator_draft' AND (NOT s.recipient_verified OR s.recipient_version<>d.recipient_version
          OR s.recipient_id IS DISTINCT FROM d.recipient_id OR NOT operator_allowed)) THEN
    UPDATE public.line_support_deliveries SET state='superseded' WHERE id=d.id;
    RETURN NULL;
  END IF;
  IF d.knowledge_revision<>p_knowledge_revision THEN
    UPDATE public.line_support_deliveries SET state='superseded' WHERE id=d.id;
    UPDATE public.line_support_events SET state='pending',lease_id=NULL,lease_until=NULL WHERE conversation_id=c.id AND revision=c.revision;
    RETURN NULL;
  END IF;
  IF d.kind='customer_reply' AND (d.reply_expires_at<=now()+interval '3 seconds' OR p_expected_reply IS DISTINCT FROM d.body) THEN
    UPDATE public.line_support_deliveries SET state='failed' WHERE id=d.id;
    UPDATE public.line_support_conversations SET mode='human' WHERE id=c.id;
    UPDATE public.line_support_events SET state='pending',lease_id=NULL,lease_until=NULL,
      reply_fallback_reason=CASE WHEN d.reply_expires_at<=now()+interval '3 seconds' THEN 'expired' ELSE 'policy' END
      WHERE conversation_id=c.id AND revision=c.revision;
    RETURN NULL;
  END IF;
  UPDATE public.line_support_deliveries SET state='sending',first_attempt_at=now(),last_attempt_at=now(),attempts=attempts+1
    WHERE id=d.id RETURNING * INTO d;
  RETURN to_jsonb(d);
END $fn$;

CREATE FUNCTION public.finish_line_support_delivery(p_delivery_id uuid,p_state text,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d public.line_support_deliveries; c public.line_support_conversations;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('accepted','unknown','failed') THEN
    RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.line_support_settings WHERE singleton FOR UPDATE;
  SELECT * INTO d FROM public.line_support_deliveries WHERE id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR d.state<>'sending' THEN RETURN false; END IF;
  UPDATE public.line_support_deliveries SET state=p_state,provider_request_id=p_request_id WHERE id=p_delivery_id;
  IF d.kind='customer_reply' AND p_state IN ('failed','unknown') THEN
    SELECT * INTO c FROM public.line_support_conversations WHERE id=d.conversation_id FOR UPDATE;
    IF c.revision=d.conversation_revision AND NOT c.blocked THEN
      UPDATE public.line_support_conversations SET mode='human' WHERE id=c.id;
      UPDATE public.line_support_events SET state='pending',lease_id=NULL,lease_until=NULL,reply_fallback_reason=p_state
        WHERE conversation_id=c.id AND revision=c.revision;
    END IF;
  END IF;
  RETURN true;
END $fn$;

CREATE FUNCTION public.manage_line_support(p_actor_id uuid,p_action text,p_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.line_support_settings; c public.line_support_conversations; v_mode text;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Platform operator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.line_support_settings WHERE singleton FOR UPDATE;
  IF p_action='pair_start' THEN
    IF (p_values->>'hash') IS NULL OR (p_values->>'hash') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid pairing hash' USING ERRCODE='22023'; END IF;
    UPDATE public.line_support_settings SET pair_hash=p_values->>'hash',pair_actor=p_actor_id,
      pair_expires_at=now()+interval '10 minutes',pair_candidate=NULL,updated_at=now() WHERE singleton;
    RETURN jsonb_build_object('status','awaiting_line_confirmation');
  ELSIF p_action='pair_confirm' THEN
    IF s.pair_actor IS DISTINCT FROM p_actor_id OR s.pair_candidate IS NULL OR s.pair_expires_at<=now() THEN
      RAISE EXCEPTION 'Pairing confirmation unavailable' USING ERRCODE='22023'; END IF;
    UPDATE public.line_support_settings SET operator_id=p_actor_id,recipient_id=pair_candidate,
      recipient_verified=true,recipient_version=recipient_version+1,
      pair_hash=NULL,pair_actor=NULL,pair_candidate=NULL,pair_expires_at=NULL,updated_at=now() WHERE singleton;
    UPDATE public.line_support_deliveries SET state='superseded' WHERE kind='operator_draft' AND state='pending';
    RETURN jsonb_build_object('status','paired');
  ELSIF p_action='unbind' THEN
    UPDATE public.line_support_settings SET rollout='observe',recipient_verified=false,recipient_id=NULL,operator_id=NULL,
      recipient_version=recipient_version+1,pair_hash=NULL,pair_actor=NULL,pair_candidate=NULL,pair_expires_at=NULL WHERE singleton;
    UPDATE public.line_support_deliveries SET state='superseded' WHERE state='pending';
    RETURN jsonb_build_object('status','unbound');
  ELSIF p_action='rollout' THEN
    IF p_values->>'mode' IS NULL OR p_values->>'mode' NOT IN ('off','observe','live') THEN
      RAISE EXCEPTION 'Invalid rollout mode' USING ERRCODE='22023'; END IF;
    IF p_values->>'mode'='live' AND (NOT s.recipient_verified OR NOT EXISTS
      (SELECT 1 FROM public.profiles WHERE id=s.operator_id AND is_platform_admin=true)) THEN
      RAISE EXCEPTION 'Verified current operator recipient required' USING ERRCODE='22023'; END IF;
    UPDATE public.line_support_settings SET rollout=p_values->>'mode',updated_at=now() WHERE singleton;
    IF s.rollout IS DISTINCT FROM p_values->>'mode' THEN
      UPDATE public.line_support_deliveries SET state='superseded' WHERE state='pending';
    END IF;
    RETURN jsonb_build_object('status','updated');
  ELSIF p_action='mode' THEN
    v_mode:=p_values->>'mode';
    IF v_mode IS NULL OR v_mode NOT IN ('automatic','human','closed') THEN
      RAISE EXCEPTION 'Invalid conversation mode' USING ERRCODE='22023'; END IF;
    SELECT * INTO c FROM public.line_support_conversations WHERE id=(p_values->>'conversationId')::uuid FOR UPDATE;
    IF NOT FOUND OR c.revision IS DISTINCT FROM (p_values->>'revision')::bigint THEN
      RAISE EXCEPTION 'Conversation changed' USING ERRCODE='PT409'; END IF;
    UPDATE public.line_support_conversations SET mode=v_mode,revision=revision+1,updated_at=now() WHERE id=c.id;
    UPDATE public.line_support_deliveries SET state='superseded' WHERE conversation_id=c.id AND state='pending';
    RETURN jsonb_build_object('status','updated');
  END IF;
  RAISE EXCEPTION 'Unknown support action' USING ERRCODE='22023';
END $fn$;

CREATE FUNCTION public.confirm_line_support_pair_candidate(p_hash text,p_line_user_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.line_support_settings;
BEGIN
  IF p_hash IS NULL OR p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN RETURN false; END IF;
  SELECT * INTO s FROM public.line_support_settings WHERE singleton FOR UPDATE;
  IF s.pair_hash IS DISTINCT FROM p_hash OR s.pair_expires_at<=now() OR s.pair_candidate IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.pair_actor AND is_platform_admin=true) THEN RETURN false; END IF;
  UPDATE public.line_support_settings SET pair_candidate=p_line_user_id,pair_hash=NULL WHERE singleton;
  RETURN true;
END $fn$;

CREATE FUNCTION public.read_line_support(p_actor_id uuid,p_conversation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE s public.line_support_settings; c public.line_support_conversations; v jsonb;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Platform operator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.line_support_settings WHERE singleton;
  IF p_conversation_id IS NULL THEN
    SELECT jsonb_agg(to_jsonb(q)) INTO v FROM
      (SELECT id,mode,revision,blocked,updated_at FROM public.line_support_conversations ORDER BY updated_at DESC,id DESC LIMIT 50) q;
    RETURN jsonb_build_object('settings',jsonb_build_object('rollout',s.rollout,'recipient_verified',s.recipient_verified,
      'recipient_version',s.recipient_version,'pair_pending',s.pair_actor=p_actor_id AND s.pair_candidate IS NOT NULL AND s.pair_expires_at>now()),
      'conversations',COALESCE(v,'[]'::jsonb));
  END IF;
  SELECT * INTO c FROM public.line_support_conversations WHERE id=p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('conversation',to_jsonb(c)-'line_user_id',
    'events',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.revision) FROM
      (SELECT event_id,revision,message_type,CASE WHEN withdrawn THEN '[送信取り消し]' ELSE body END AS body,
        occurred_at,received_at,withdrawn FROM public.line_support_events WHERE conversation_id=c.id ORDER BY revision DESC LIMIT 30) q),'[]'::jsonb),
    'drafts',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM
      (SELECT id,conversation_revision,knowledge_revision,model_version,body,created_at FROM public.line_support_drafts WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 5) q),'[]'::jsonb),
    'deliveries',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM
      (SELECT id,conversation_revision,kind,state,attempts,created_at,CASE WHEN kind='customer_reply' THEN body ELSE NULL END AS preview
        FROM public.line_support_deliveries WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 10) q),'[]'::jsonb));
END $fn$;

CREATE FUNCTION public.line_support_work(p_event_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v jsonb; BEGIN
  SELECT jsonb_agg(to_jsonb(q)) INTO v FROM
    (SELECT event_id FROM public.line_support_events e WHERE (state='pending' OR (state='processing' AND lease_until<now())
      OR (state='done' AND EXISTS(SELECT 1 FROM public.line_support_deliveries d CROSS JOIN public.line_support_settings s
        WHERE d.conversation_id=e.conversation_id AND d.conversation_revision=e.revision AND d.state='pending' AND s.singleton AND s.rollout='live')))
      AND (p_event_id IS NULL OR event_id=p_event_id) ORDER BY received_at LIMIT 5) q;
  RETURN COALESCE(v,'[]'::jsonb);
END $fn$;

CREATE FUNCTION public.line_support_history(p_conversation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.revision),'[]'::jsonb) FROM
    (SELECT revision,message_type,left(body,1000) AS body FROM public.line_support_events
      WHERE conversation_id=p_conversation_id AND NOT withdrawn AND message_type NOT IN ('unfollow','unsend','follow')
      ORDER BY revision DESC LIMIT 8) q;
$fn$;

-- Minimal read-only context for fresh policy validation before claiming an external effect.
CREATE FUNCTION public.line_support_delivery_context(p_delivery_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object('kind',d.kind,'question',CASE WHEN d.kind='customer_reply' THEN e.body ELSE NULL END,
   'message_type',e.message_type,'mode',c.mode)
 FROM public.line_support_deliveries d JOIN public.line_support_events e
 ON e.conversation_id=d.conversation_id AND e.revision=d.conversation_revision
 JOIN public.line_support_conversations c ON c.id=d.conversation_id
 WHERE d.id=p_delivery_id AND d.state='pending' AND c.revision=d.conversation_revision;
$fn$;
REVOKE ALL ON FUNCTION public.line_support_delivery_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.line_support_delivery_context(uuid) TO service_role;

-- Queue acknowledgement is based on durable state, including the crash window
-- between preparing a delivery and calling the external LINE API.
CREATE FUNCTION public.line_support_job_status(p_event_id text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
  SELECT jsonb_build_object('state',e.state,'rollout',s.rollout,
    'delivery_id',(SELECT d.id FROM public.line_support_deliveries d
      WHERE d.conversation_id=e.conversation_id AND d.conversation_revision=e.revision
        AND d.state='pending' ORDER BY d.created_at LIMIT 1))
  FROM public.line_support_events e CROSS JOIN public.line_support_settings s
  WHERE e.event_id=p_event_id AND s.singleton;
$fn$;

REVOKE ALL ON FUNCTION public.line_support_job_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.line_support_job_status(text) TO service_role;

REVOKE ALL ON FUNCTION public.accept_line_support_event(text,text,text,text,text,timestamptz,boolean,jsonb,text),
  public.claim_line_support_event(text,uuid),public.prepare_line_support_delivery(text,uuid,uuid,uuid,text,text,text,text,text),
  public.claim_line_support_delivery(uuid,text,text),public.finish_line_support_delivery(uuid,text,text),
  public.manage_line_support(uuid,text,jsonb),public.confirm_line_support_pair_candidate(text,text),
  public.read_line_support(uuid,uuid),public.line_support_work(text),public.line_support_history(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_line_support_event(text,text,text,text,text,timestamptz,boolean,jsonb,text),
  public.claim_line_support_event(text,uuid),public.prepare_line_support_delivery(text,uuid,uuid,uuid,text,text,text,text,text),
  public.claim_line_support_delivery(uuid,text,text),public.finish_line_support_delivery(uuid,text,text),
  public.manage_line_support(uuid,text,jsonb),public.confirm_line_support_pair_candidate(text,text),
  public.read_line_support(uuid,uuid),public.line_support_work(text),public.line_support_history(uuid) TO service_role;
COMMIT;
