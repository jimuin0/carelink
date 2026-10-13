-- Consumer-first. No historical notifications are reconstructed. The old
-- mutation gateways do not invoke this publisher; new gateways follow later.
-- RLS already denies these roles. Also revoke unused direct grants before
-- storing captured endpoint encryption material in the private retry queue.
REVOKE ALL ON public.webhook_retry_queue FROM PUBLIC,anon,authenticated;
CREATE TABLE public.customer_booking_channel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  booking_revision timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cancelled','rescheduled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(booking_id,booking_revision,kind),
  UNIQUE(id,booking_id,booking_revision,kind)
);
ALTER TABLE public.customer_booking_channel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_booking_channel_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.customer_booking_channel_events TO service_role;
CREATE TABLE public.customer_booking_channel_operations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  booking_revision timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cancelled','rescheduled')),
  channel text NOT NULL CHECK (channel IN ('push','line','lineworks')),
  role text NOT NULL CHECK (role IN ('customer','owner','staff')),
  target_hash text NOT NULL CHECK (target_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((channel='push' AND (role='owner' OR (role='customer' AND kind='rescheduled')))
    OR (channel='line' AND role='customer' AND kind='cancelled') OR (channel='lineworks' AND role='staff')),
  FOREIGN KEY(event_id,booking_id,booking_revision,kind)
    REFERENCES public.customer_booking_channel_events(id,booking_id,booking_revision,kind) ON DELETE CASCADE,
  UNIQUE(booking_id,booking_revision,kind,channel,role,target_hash)
);
ALTER TABLE public.customer_booking_channel_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_booking_channel_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.customer_booking_channel_operations TO service_role;
COMMENT ON TABLE public.customer_booking_channel_operations IS 'Service-only immutable delivery identities. Queue deletion never permits replay. No contact details or subscription secrets retained here.';

CREATE TABLE public.customer_booking_channel_rejections (
  operation_id uuid NOT NULL REFERENCES public.customer_booking_channel_operations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  provider_status integer NOT NULL CHECK (provider_status IN (400,401,403,404,410,413,422,429)),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(operation_id,started_at)
);
ALTER TABLE public.customer_booking_channel_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_booking_channel_rejections FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.customer_booking_channel_rejections TO service_role;

CREATE FUNCTION public.booking_push_subscription_fingerprint(p_endpoint text,p_p256dh text,p_auth text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
  SELECT encode(pg_catalog.sha256(pg_catalog.convert_to(p_endpoint||chr(31)||p_p256dh||chr(31)||p_auth,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.booking_push_subscription_fingerprint(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_push_subscription_fingerprint(text,text,text) TO service_role;

CREATE FUNCTION public.publish_customer_booking_channels(p_booking_id uuid,p_kind text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; snapshot jsonb;
  recipient record; operation_id uuid; event_id uuid; queued integer:=0; owner_push boolean; menu_name text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('cancelled','rescheduled')
    OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'BOOKING_CHANNEL_CAPABILITY_UNAVAILABLE'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND OR b.user_id IS NULL OR (p_kind='cancelled' AND b.status<>'cancelled')
    OR (p_kind='rescheduled' AND b.status NOT IN ('pending','confirmed')) THEN RAISE EXCEPTION 'BOOKING_CHANNEL_STATE_MISMATCH'; END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_CHANNEL_FACILITY_UNAVAILABLE'; END IF;
  INSERT INTO public.customer_booking_channel_events(booking_id,booking_revision,kind)
    VALUES(b.id,coalesce(b.updated_at,b.created_at),p_kind) ON CONFLICT DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NULL THEN RETURN 0; END IF;
  SELECT m.name INTO menu_name FROM public.facility_menus m WHERE m.id=b.menu_id AND m.facility_id=b.facility_id;
  SELECT CASE WHEN p_kind='cancelled' THEN n.push_on_cancel ELSE n.push_on_new_booking END
    INTO owner_push FROM public.facility_notification_settings n WHERE n.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'actorUserId',b.user_id,
    'customerName',coalesce(b.customer_name,'お客様'),'facilityName',coalesce(f.name,''),
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',coalesce(menu_name,''));
  FOR recipient IN
    SELECT 'push'::text AS channel,'customer'::text AS role,s.id::text AS target,b.user_id AS user_id,
      '[]'::jsonb AS staff_ids,public.booking_push_subscription_fingerprint(s.endpoint,s.p256dh,s.auth) AS subscription_proof,
      NULL::timestamptz AS line_proof,jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) AS push_subscription
      FROM public.push_subscriptions s WHERE p_kind='rescheduled' AND s.user_id=b.user_id
    UNION ALL
    SELECT DISTINCT 'push','owner',s.id::text,m.user_id,'[]'::jsonb,
      public.booking_push_subscription_fingerprint(s.endpoint,s.p256dh,s.auth),NULL::timestamptz,
      jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)
      FROM public.facility_members m JOIN public.push_subscriptions s ON s.user_id=m.user_id
      WHERE coalesce(owner_push,true) AND m.facility_id=b.facility_id AND m.role IN ('owner','admin')
    UNION ALL
    SELECT 'line','customer',l.line_user_id,b.user_id,'[]'::jsonb,NULL::text,l.verified_at,NULL::jsonb
      FROM public.profiles p JOIN public.line_user_links l ON l.user_id=p.id AND l.line_user_id=p.line_user_id
      WHERE p_kind='cancelled' AND p.id=b.user_id AND l.proof_version=1 AND l.verified_at IS NOT NULL
    UNION ALL
    SELECT 'lineworks','staff',s.line_works_channel_id,NULL::uuid,jsonb_agg(s.id ORDER BY s.id),NULL::text,NULL::timestamptz,NULL::jsonb
      FROM public.staff_profiles s WHERE s.facility_id=b.facility_id AND coalesce(s.is_active,true)
        AND nullif(s.line_works_channel_id,'') IS NOT NULL AND (s.id=b.staff_id OR coalesce(s.line_works_notify_all,false))
      GROUP BY s.line_works_channel_id
  LOOP
    IF queued>=500 THEN RAISE EXCEPTION 'BOOKING_CHANNEL_PLAN_LIMIT'; END IF;
    operation_id:=NULL;
    INSERT INTO public.customer_booking_channel_operations(id,event_id,booking_id,booking_revision,kind,channel,role,target_hash)
      VALUES(gen_random_uuid(),event_id,b.id,coalesce(b.updated_at,b.created_at),p_kind,recipient.channel,recipient.role,
        encode(pg_catalog.sha256(pg_catalog.convert_to(recipient.target,'UTF8')),'hex')) ON CONFLICT DO NOTHING RETURNING id INTO operation_id;
    IF operation_id IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
      VALUES(operation_id,'customer_booking_'||recipient.channel,recipient.target,b.facility_id,
        jsonb_build_object('customer_booking_channel_version',1,'operationId',operation_id,'eventId',event_id,'kind',p_kind,
          'role',recipient.role,'recipientUserId',recipient.user_id,'recipientStaffIds',recipient.staff_ids,
          'subscriptionProof',recipient.subscription_proof,'pushSubscription',recipient.push_subscription,
          'lineProof',recipient.line_proof,'snapshot',snapshot), 'pending',now());
    queued:=queued+1;
  END LOOP;
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.publish_customer_booking_channels(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_customer_booking_channels(uuid,text) TO service_role;

CREATE FUNCTION public.protect_customer_booking_channel_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.payload ? 'customer_booking_channel_version' AND
    (NEW.id IS DISTINCT FROM OLD.id OR NEW.webhook_type IS DISTINCT FROM OLD.webhook_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.payload IS DISTINCT FROM OLD.payload) THEN RAISE EXCEPTION 'BOOKING_CHANNEL_QUEUE_IMMUTABLE'; END IF;
  IF OLD.payload ? 'customer_booking_channel_version' AND OLD.delivery_started_at IS NOT NULL
    AND NEW.delivery_started_at IS DISTINCT FROM OLD.delivery_started_at
    AND current_setting('carelink.booking_channel_rejection',true) IS DISTINCT FROM OLD.id::text||'/'||OLD.delivery_started_at::text THEN
    RAISE EXCEPTION 'BOOKING_CHANNEL_REJECTION_RECEIPT_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_customer_booking_channel_queue() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_customer_booking_channel_queue BEFORE UPDATE ON public.webhook_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer_booking_channel_queue();

CREATE FUNCTION public.start_customer_booking_channel(p_queue_id uuid,p_claimed_at timestamptz)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE; o public.customer_booking_channel_operations%ROWTYPE;
  b public.bookings%ROWTYPE; recipient uuid; actor uuid; uid uuid; fid uuid; owner_push boolean; valid boolean:=false; stamp timestamptz;
BEGIN
  SELECT * INTO o FROM public.customer_booking_channel_operations WHERE customer_booking_channel_operations.id=p_queue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_CHANNEL_OPERATION_UNAVAILABLE'; END IF;
  SELECT user_id,facility_id INTO actor,fid FROM public.bookings WHERE bookings.id=o.booking_id;
  SELECT nullif(payload->>'recipientUserId','')::uuid INTO recipient FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id;
  FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[actor,recipient]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM public.lock_booking_account(uid);
  END LOOP;
  -- Parent first, then booking. The strong parent lock also serializes an absent
  -- settings/member row with its FK insert at the send boundary.
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=fid FOR UPDATE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=o.booking_id FOR SHARE;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN; END IF;
  IF q.webhook_type IS DISTINCT FROM 'customer_booking_'||o.channel
    OR q.payload->'customer_booking_channel_version' IS DISTINCT FROM '1'::jsonb
    OR q.payload->>'operationId' IS DISTINCT FROM o.id::text
    OR q.payload->>'eventId' IS DISTINCT FROM o.event_id::text
    OR q.payload->>'kind' IS DISTINCT FROM o.kind OR q.payload->>'role' IS DISTINCT FROM o.role
    OR (q.payload->'snapshot'->>'bookingId')::uuid IS DISTINCT FROM o.booking_id
    OR (q.payload->'snapshot'->>'bookingRevision')::timestamptz IS DISTINCT FROM o.booking_revision
    OR encode(pg_catalog.sha256(pg_catalog.convert_to(q.target_id,'UTF8')),'hex') IS DISTINCT FROM o.target_hash THEN
    RAISE EXCEPTION 'BOOKING_CHANNEL_FENCE_INVALID';
  END IF;
  valid:=b.id IS NOT NULL AND b.user_id IS NOT NULL AND b.facility_id=q.facility_id
    AND coalesce(b.updated_at,b.created_at)=o.booking_revision
    AND b.user_id::text=q.payload->'snapshot'->>'actorUserId'
    AND b.booking_date::text=q.payload->'snapshot'->>'bookingDate'
    AND b.start_time::text=q.payload->'snapshot'->>'startTime'
    AND b.end_time::text=q.payload->'snapshot'->>'endTime'
    AND ((o.kind='cancelled' AND b.status='cancelled') OR (o.kind='rescheduled' AND b.status IN ('pending','confirmed')))
    AND EXISTS(SELECT 1 FROM public.customer_booking_channel_events e
      WHERE e.id=o.event_id AND e.created_at>clock_timestamp()-interval '7 days');
  IF valid AND o.role='customer' THEN valid:=recipient=b.user_id; END IF;
  IF valid AND o.role='owner' THEN
    PERFORM m.user_id FROM public.facility_members m WHERE m.facility_id=b.facility_id AND m.user_id=recipient AND m.role IN ('owner','admin') FOR SHARE;
    valid:=FOUND;
    IF valid THEN
      SELECT CASE WHEN o.kind='cancelled' THEN n.push_on_cancel ELSE n.push_on_new_booking END INTO owner_push
        FROM public.facility_notification_settings n WHERE n.facility_id=b.facility_id FOR SHARE;
      valid:=coalesce(owner_push,true);
    END IF;
  END IF;
  IF valid AND o.channel='push' THEN
    PERFORM s.id FROM public.push_subscriptions s WHERE s.id=q.target_id::uuid AND s.user_id=recipient
      AND public.booking_push_subscription_fingerprint(s.endpoint,s.p256dh,s.auth)=q.payload->>'subscriptionProof' FOR SHARE;
    valid:=FOUND;
  ELSIF valid AND o.channel='line' THEN
    PERFORM p.id FROM public.profiles p JOIN public.line_user_links l ON l.user_id=p.id AND l.line_user_id=p.line_user_id
      WHERE o.kind='cancelled' AND o.role='customer' AND p.id=recipient AND l.line_user_id=q.target_id
        AND l.proof_version=1 AND l.verified_at=(q.payload->>'lineProof')::timestamptz FOR SHARE OF p,l;
    valid:=FOUND;
  ELSIF valid AND o.channel='lineworks' THEN
    PERFORM s.id FROM public.staff_profiles s WHERE o.role='staff' AND s.id IN
      (SELECT value::uuid FROM jsonb_array_elements_text(q.payload->'recipientStaffIds'))
      AND s.facility_id=b.facility_id AND s.line_works_channel_id=q.target_id AND coalesce(s.is_active,true)
      AND (s.id=b.staff_id OR coalesce(s.line_works_notify_all,false)) FOR SHARE;
    valid:=FOUND;
  END IF;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
    RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN;
  END IF;
  IF NOT coalesce(valid,false) THEN
    UPDATE public.webhook_retry_queue SET status='failed',last_error='customer_booking_channel_superseded',processed_at=clock_timestamp() WHERE webhook_retry_queue.id=q.id;
    RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
  END IF;
  stamp:=clock_timestamp();
  UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE webhook_retry_queue.id=q.id;
  RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_customer_booking_channel(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_customer_booking_channel(uuid,timestamptz) TO service_role;

-- Only a definitive provider refusal permits retry. Network/5xx/ambiguous
-- results never invoke this routine, and never clear the persistent start fence.
CREATE FUNCTION public.record_customer_booking_channel_rejection(p_queue_id uuid,p_claimed_at timestamptz,
  p_started_at timestamptz,p_provider_status integer)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE; next_attempt integer;
BEGIN
  IF p_provider_status IS NULL OR p_provider_status NOT IN (400,401,403,404,410,413,422,429) THEN
    RAISE EXCEPTION 'BOOKING_CHANNEL_REJECTION_UNPROVEN'; END IF;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.payload->'customer_booking_channel_version' IS DISTINCT FROM '1'::jsonb
    OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at
    OR p_started_at IS NULL OR q.delivery_started_at IS DISTINCT FROM p_started_at THEN RETURN 'not_owned'; END IF;
  INSERT INTO public.customer_booking_channel_rejections(operation_id,started_at,provider_status)
    VALUES(q.id,p_started_at,p_provider_status);
  next_attempt:=q.attempt_count+1;
  IF next_attempt>=q.max_attempts THEN
    UPDATE public.webhook_retry_queue SET status='failed',attempt_count=next_attempt,processed_at=clock_timestamp(),
      last_error='customer_booking_channel_provider_rejected' WHERE webhook_retry_queue.id=q.id;
    RETURN 'dead-letter';
  END IF;
  PERFORM set_config('carelink.booking_channel_rejection',q.id::text||'/'||q.delivery_started_at::text,true);
  UPDATE public.webhook_retry_queue SET status='pending',attempt_count=next_attempt,claimed_at=NULL,delivery_started_at=NULL,
    scheduled_at=clock_timestamp()+make_interval(secs=>least(3600,300*(2^q.attempt_count)::integer)),
    last_error='customer_booking_channel_provider_rejected' WHERE webhook_retry_queue.id=q.id;
  PERFORM set_config('carelink.booking_channel_rejection','',true);
  RETURN 'rescheduled';
END $$;
REVOKE ALL ON FUNCTION public.record_customer_booking_channel_rejection(uuid,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_booking_channel_rejection(uuid,timestamptz,timestamptz,integer) TO service_role;
