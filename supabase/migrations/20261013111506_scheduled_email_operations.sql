-- Fence legacy Cron producers at their checked read/claim paths. These values
-- were written BEFORE provider calls and are NOT delivery evidence. Preserve
-- them verbatim and never reset or infer historical acceptance from them.
ALTER TABLE public.bookings RENAME COLUMN review_request_sent_at TO review_request_legacy_claimed_at;
ALTER TABLE public.profiles RENAME COLUMN favorites_digest_sent_week TO favorites_digest_legacy_claimed_week;
ALTER TABLE public.bookings ADD COLUMN review_request_provider_accepted_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN favorites_digest_provider_accepted_week text;

-- NULL legacy markers can mean "provider accepted, response lost, claim cleared".
-- This immutable deployment boundary prevents pretending those old NULLs are
-- unattempted. Current-week digests and pre-cutover bookings require reconciliation.
CREATE TABLE public.scheduled_email_cutover (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.scheduled_email_cutover DEFAULT VALUES;
ALTER TABLE public.scheduled_email_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_email_cutover FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.scheduled_email_cutover TO service_role;
CREATE FUNCTION public.scheduled_email_cutover_at() RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE stamp timestamptz;
BEGIN
 SELECT c.installed_at INTO stamp FROM public.scheduled_email_cutover c WHERE c.singleton;
 IF stamp IS NULL THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_CUTOVER_UNAVAILABLE'; END IF;
 RETURN stamp;
END $$;
REVOKE ALL ON FUNCTION public.scheduled_email_cutover_at() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_email_cutover_at() TO service_role;

CREATE TABLE public.scheduled_email_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('review_request','favorites_digest')),
 source_id uuid NOT NULL,
 period text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 accepted_at timestamptz,
 UNIQUE(kind,source_id,period)
);
ALTER TABLE public.scheduled_email_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_email_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.scheduled_email_operations TO service_role;
GRANT UPDATE(published_at,accepted_at) ON public.scheduled_email_operations TO service_role;

CREATE FUNCTION public.scheduled_digest_content(p_user_id uuid,p_since timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'slug',x.slug,
  'newCoupons',x.coupon_count,'hasNewMenus',x.has_menus) ORDER BY x.id),'[]'::jsonb)
 FROM (
  SELECT f.id,f.name,f.slug,
   (SELECT count(*) FROM public.coupons c WHERE c.facility_id=f.id AND c.is_active AND c.created_at>=p_since) AS coupon_count,
   EXISTS(SELECT 1 FROM public.facility_menus m WHERE m.facility_id=f.id AND m.is_published IS DISTINCT FROM false AND m.created_at>=p_since) AS has_menus
  FROM public.favorites fav JOIN public.facility_profiles f ON f.id=fav.facility_id
  WHERE fav.user_id=p_user_id AND f.status='published'
 ) x WHERE x.coupon_count>0 OR x.has_menus;
$$;
REVOKE ALL ON FUNCTION public.scheduled_digest_content(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_digest_content(uuid,timestamptz) TO service_role;

CREATE FUNCTION public.list_scheduled_digest_recipients(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS TABLE(user_id uuid) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'DIGEST_PAGE_LIMIT_INVALID'; END IF;
 RETURN QUERY SELECT DISTINCT f.user_id FROM public.favorites f JOIN public.profiles p ON p.id=f.user_id
  WHERE (p_after IS NULL OR f.user_id>p_after)
   AND p.email_unsubscribed IS NOT DISTINCT FROM false
   AND p.favorites_digest_legacy_claimed_week IS DISTINCT FROM to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')
   AND to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')>to_char(public.scheduled_email_cutover_at() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')
   AND NOT EXISTS(SELECT 1 FROM public.scheduled_email_operations o WHERE o.kind='favorites_digest' AND o.source_id=f.user_id
    AND o.period=to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW') AND o.published_at IS NOT NULL)
  ORDER BY f.user_id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_scheduled_digest_recipients(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_scheduled_digest_recipients(uuid,integer) TO service_role;

CREATE FUNCTION public.list_scheduled_review_recipients(p_after_updated_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 1000)
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
  AND (p_after_id IS NULL OR (b.updated_at,b.id)>(p_after_updated_at,p_after_id))
  AND NOT EXISTS(SELECT 1 FROM public.scheduled_email_operations o WHERE o.kind='review_request' AND o.source_id=b.id AND o.period='once' AND o.published_at IS NOT NULL)
  ORDER BY b.updated_at,b.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_scheduled_review_recipients(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_scheduled_review_recipients(timestamptz,uuid,integer) TO service_role;
CREATE INDEX scheduled_review_candidates ON public.bookings(updated_at,id)
 WHERE status='completed' AND review_request_legacy_claimed_at IS NULL AND review_request_provider_accepted_at IS NULL;

CREATE FUNCTION public.scheduled_email_legacy_holds() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('review_request',(SELECT count(*) FROM public.bookings b WHERE b.status='completed'
   AND b.updated_at BETWEEN now()-interval '7 days' AND now()-interval '24 hours'
   AND (b.review_request_legacy_claimed_at IS NOT NULL OR b.created_at<public.scheduled_email_cutover_at()) AND b.review_request_provider_accepted_at IS NULL),
  'favorites_digest',(SELECT count(*) FROM public.profiles p
   WHERE (p.favorites_digest_legacy_claimed_week=to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')
     OR (to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')<=to_char(public.scheduled_email_cutover_at() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')
       AND p.created_at<public.scheduled_email_cutover_at() AND EXISTS(SELECT 1 FROM public.favorites f WHERE f.user_id=p.id)))
    AND p.favorites_digest_provider_accepted_week IS DISTINCT FROM to_char(now() AT TIME ZONE 'Asia/Tokyo','IYYY-"W"IW')));
$$;
REVOKE ALL ON FUNCTION public.scheduled_email_legacy_holds() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_email_legacy_holds() TO service_role;

CREATE FUNCTION public.reserve_scheduled_email_atomic(p_kind text,p_source_id uuid,p_email text DEFAULT NULL)
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

CREATE FUNCTION public.prepare_scheduled_email_atomic(p_operation_id uuid,p_envelope jsonb)
RETURNS TABLE(id uuid,status text,created boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.scheduled_email_operations%ROWTYPE; q public.webhook_retry_queue%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.scheduled_email_operations WHERE scheduled_email_operations.id=p_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_OPERATION_NOT_FOUND'; END IF;
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_operation_id;
 IF FOUND THEN
  IF q.webhook_type<>'email' OR q.target_id IS DISTINCT FROM o.snapshot->>'email'
   OR q.payload->>'scheduled_kind' IS DISTINCT FROM o.kind THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_IDENTITY_MISMATCH'; END IF;
  RETURN QUERY SELECT q.id,CASE WHEN q.status='processing' AND q.delivery_started_at IS NOT NULL THEN 'uncertain'
   WHEN q.status='failed' AND q.last_error='scheduled_email_superseded' THEN 'superseded' ELSE q.status END,false; RETURN;
 END IF;
 -- A deleted queue job is NOT proof that no earlier provider call was accepted.
 IF o.published_at IS NOT NULL THEN RETURN QUERY SELECT o.id,'uncertain'::text,false; RETURN; END IF;
 IF jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR NOT(p_envelope ?& ARRAY['from','to','subject','html'])
  OR p_envelope-ARRAY['from','to','subject','html']<>'{}'::jsonb OR p_envelope->>'to' IS DISTINCT FROM o.snapshot->>'email'
  OR jsonb_typeof(p_envelope->'from') IS DISTINCT FROM 'string' OR length(p_envelope->>'from') NOT BETWEEN 1 AND 320
  OR jsonb_typeof(p_envelope->'subject') IS DISTINCT FROM 'string' OR length(p_envelope->>'subject') NOT BETWEEN 1 AND 200
  OR jsonb_typeof(p_envelope->'html') IS DISTINCT FROM 'string' OR length(p_envelope->>'html') NOT BETWEEN 1 AND 100000 THEN
  RAISE EXCEPTION 'SCHEDULED_EMAIL_ENVELOPE_INVALID';
 END IF;
 INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,email_envelope,status,scheduled_at)
 VALUES(o.id,'email',o.snapshot->>'email',CASE WHEN o.kind='review_request' THEN (o.snapshot->>'facilityId')::uuid ELSE NULL END,
  jsonb_build_object('event_email_version',1,'dispatch_version',2,'idempotency_key','carelink-event-email/'||o.id::text,
   'scheduled_email_version',1,'scheduled_kind',o.kind,'scheduled_user_id',CASE WHEN o.kind='favorites_digest' THEN o.source_id ELSE NULL END),p_envelope,'pending',now());
 UPDATE public.scheduled_email_operations SET published_at=clock_timestamp() WHERE scheduled_email_operations.id=o.id;
 RETURN QUERY SELECT o.id,'pending'::text,true;
END $$;
REVOKE ALL ON FUNCTION public.prepare_scheduled_email_atomic(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_scheduled_email_atomic(uuid,jsonb) TO service_role;

CREATE FUNCTION public.start_scheduled_email_delivery(p_queue_id uuid,p_claimed_at timestamptz,p_recipient_current boolean)
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
    AND (b.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=b.user_id AND pr.email_unsubscribed IS NOT TRUE));
 ELSE
  SELECT * INTO p FROM public.profiles WHERE profiles.id=o.source_id FOR SHARE;
  valid:=p.id IS NOT NULL AND p.email_unsubscribed IS NOT DISTINCT FROM false AND p_recipient_current IS TRUE
    AND EXISTS(SELECT 1 FROM public.email_unsubscribe_tokens t WHERE t.token=o.snapshot->>'unsubscribeToken' AND t.user_id=o.source_id)
    AND public.scheduled_digest_content(o.source_id,(o.snapshot->>'since')::timestamptz)=o.snapshot->'facilities';
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

CREATE FUNCTION public.guard_scheduled_email_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at)
  OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at) THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_RECEIPT_IMMUTABLE'; END IF;
 IF NEW.published_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue q WHERE q.id=NEW.id) THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_PUBLICATION_NOT_CONFIRMED'; END IF;
 IF NEW.accepted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue q WHERE q.id=NEW.id AND q.status='success'
  AND q.provider_message_id IS NOT NULL AND q.delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_ACCEPTANCE_NOT_CONFIRMED'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_scheduled_email_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_scheduled_email_receipt BEFORE UPDATE ON public.scheduled_email_operations FOR EACH ROW EXECUTE FUNCTION public.guard_scheduled_email_receipt();

CREATE FUNCTION public.record_scheduled_email_acceptance() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.scheduled_email_operations%ROWTYPE;
BEGIN
 IF NEW.webhook_type='email' AND NEW.payload ? 'scheduled_email_version' AND NEW.status='success' THEN
  SELECT * INTO o FROM public.scheduled_email_operations WHERE scheduled_email_operations.id=NEW.id;
  IF NOT FOUND OR NEW.provider_message_id IS NULL OR NEW.delivered_at IS NULL OR NEW.target_id IS DISTINCT FROM o.snapshot->>'email'
    OR NEW.payload->>'scheduled_kind' IS DISTINCT FROM o.kind THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_ACCEPTANCE_NOT_CONFIRMED'; END IF;
  UPDATE public.scheduled_email_operations SET accepted_at=coalesce(accepted_at,NEW.delivered_at) WHERE scheduled_email_operations.id=o.id;
  IF o.kind='review_request' THEN UPDATE public.bookings SET review_request_provider_accepted_at=NEW.delivered_at WHERE bookings.id=o.source_id;
  ELSE UPDATE public.profiles SET favorites_digest_provider_accepted_week=o.period WHERE profiles.id=o.source_id; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_scheduled_email_acceptance() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER record_scheduled_email_acceptance AFTER INSERT OR UPDATE ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION public.record_scheduled_email_acceptance();
