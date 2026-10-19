-- Trusted gateway: fixed operations, actor authority locked until commit.
CREATE FUNCTION public.manage_platform_control_atomic(p_actor_id uuid,p_record_id uuid,p_kind text,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed text[]; f public.feature_flags%ROWTYPE; c public.contacts%ROWTYPE; result jsonb;
BEGIN
 allowed=CASE p_kind WHEN 'flag:create' THEN ARRAY['key','enabled','rollout_pct','description']
  WHEN 'flag:update' THEN ARRAY['enabled','rollout_pct']
  WHEN 'ticket:update' THEN ARRAY['ticket_status','priority','ticket_notes']
  WHEN 'facility:verify' THEN ARRAY['is_verified','verified_type'] ELSE NULL END;
 IF allowed IS NULL OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb
  OR p_values-allowed<>'{}'::jsonb OR (p_kind='flag:create' AND p_record_id IS NOT NULL)
  OR (p_kind<>'flag:create' AND p_record_id IS NULL)
 THEN RAISE EXCEPTION 'INVALID_PLATFORM_CONTROL' USING ERRCODE='22023'; END IF;
 BEGIN
  PERFORM public.lock_booking_account(p_actor_id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='BOOKING_ACCOUNT_UNAVAILABLE' THEN RAISE EXCEPTION 'PLATFORM_CONTROL_FORBIDDEN' USING ERRCODE='42501'; ELSE RAISE; END IF;
 END;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_CONTROL_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_kind IN ('flag:create','flag:update') THEN
  IF p_kind='flag:update' THEN
   SELECT * INTO f FROM public.feature_flags WHERE id=p_record_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_CONTROL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  END IF;
  IF (p_values ? 'enabled' AND jsonb_typeof(p_values->'enabled') IS DISTINCT FROM 'boolean')
   OR (p_values ? 'rollout_pct' AND CASE WHEN jsonb_typeof(p_values->'rollout_pct')='number' THEN (p_values->>'rollout_pct')::numeric NOT BETWEEN 0 AND 100 OR trunc((p_values->>'rollout_pct')::numeric)<>(p_values->>'rollout_pct')::numeric ELSE true END)
   OR (p_values ? 'description' AND (jsonb_typeof(p_values->'description') NOT IN ('null','string') OR char_length(p_values->>'description')>500))
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_CONTROL' USING ERRCODE='22023'; END IF;
  SELECT * INTO f FROM jsonb_populate_record(f,p_values);
  IF p_kind='flag:create' THEN
   IF jsonb_typeof(p_values->'key') IS DISTINCT FROM 'string' OR f.key IS NULL OR char_length(f.key) NOT BETWEEN 1 AND 100 OR f.key !~ '^[a-z0-9_-]+$' THEN RAISE EXCEPTION 'INVALID_PLATFORM_CONTROL' USING ERRCODE='22023'; END IF;
   INSERT INTO public.feature_flags(key,enabled,rollout_pct,description) VALUES(f.key,coalesce(f.enabled,false),coalesce(f.rollout_pct,0),f.description) RETURNING to_jsonb(feature_flags.*) INTO result;
  ELSE
   UPDATE public.feature_flags SET enabled=f.enabled,rollout_pct=f.rollout_pct,updated_at=clock_timestamp() WHERE id=p_record_id RETURNING to_jsonb(feature_flags.*) INTO result;
  END IF;
 ELSIF p_kind='ticket:update' THEN
  IF (p_values ? 'ticket_status' AND (jsonb_typeof(p_values->'ticket_status') IS DISTINCT FROM 'string' OR p_values->>'ticket_status' NOT IN ('open','in_progress','waiting','resolved','closed')))
   OR (p_values ? 'priority' AND (jsonb_typeof(p_values->'priority') IS DISTINCT FROM 'string' OR p_values->>'priority' NOT IN ('low','normal','high','urgent')))
   OR (p_values ? 'ticket_notes' AND (jsonb_typeof(p_values->'ticket_notes') NOT IN ('null','string') OR char_length(p_values->>'ticket_notes')>2000))
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_CONTROL' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.contacts WHERE id=p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_CONTROL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_values ? 'ticket_status' THEN
   IF p_values->>'ticket_status'='resolved' THEN
    IF c.ticket_status<>'resolved' THEN c.resolved_at=clock_timestamp(); END IF;
   ELSE c.resolved_at=NULL; END IF;
  END IF;
  SELECT * INTO c FROM jsonb_populate_record(c,p_values);
  UPDATE public.contacts SET ticket_status=c.ticket_status,priority=c.priority,ticket_notes=c.ticket_notes,resolved_at=c.resolved_at WHERE id=p_record_id RETURNING jsonb_build_object('id',id,'ticket_status',ticket_status,'priority',priority,'ticket_notes',ticket_notes,'resolved_at',resolved_at) INTO result;
 ELSE
  IF jsonb_typeof(p_values->'is_verified') IS DISTINCT FROM 'boolean'
   OR (p_values ? 'verified_type' AND (jsonb_typeof(p_values->'verified_type') IS DISTINCT FROM 'string' OR p_values->>'verified_type' NOT IN ('phone','identity','site_visit')))
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_CONTROL' USING ERRCODE='22023'; END IF;
  UPDATE public.facility_profiles SET is_verified=(p_values->>'is_verified')::boolean,
   verified_type=CASE WHEN (p_values->>'is_verified')::boolean THEN coalesce(p_values->>'verified_type','phone') ELSE NULL END,
   verified_at=CASE WHEN (p_values->>'is_verified')::boolean THEN clock_timestamp() ELSE NULL END
   WHERE id=p_record_id RETURNING jsonb_build_object('id',id,'is_verified',is_verified,'verified_type',verified_type) INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_CONTROL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.manage_platform_control_atomic(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_platform_control_atomic(uuid,uuid,text,jsonb) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.feature_flags FROM PUBLIC,anon,authenticated;
