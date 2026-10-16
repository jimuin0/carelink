-- Rebind only undispatched creates; never move started writes or mapped events.
CREATE OR REPLACE FUNCTION public.prepare_calendar_operation(p_id uuid,p_actor uuid,p_booking uuid,p_kind text,p_payload jsonb,p_calendar text,p_token_id uuid,p_token_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.calendar_sync_operations%ROWTYPE; m public.booking_calendar_events%ROWTYPE; has_map boolean;
BEGIN
 IF p_id IS NULL OR p_actor IS NULL OR p_booking IS NULL OR p_kind NOT IN ('sync','delete') OR p_kind IS NULL THEN RETURN jsonb_build_object('state','conflict'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor FOR KEY SHARE;
 PERFORM 1 FROM public.bookings WHERE id=p_booking AND user_id=p_actor FOR KEY SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-calendar:'||p_actor::text||':'||p_booking::text,0));
 SELECT * INTO r FROM public.calendar_sync_operations WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>p_actor OR r.booking_id<>p_booking OR r.kind<>p_kind THEN RETURN jsonb_build_object('state','conflict'); END IF;
  IF r.state='succeeded' THEN RETURN to_jsonb(r); END IF;
  IF r.state='prepared' THEN
   IF p_calendar IS NULL OR p_calendar='' OR p_calendar='primary' OR NOT EXISTS(SELECT 1 FROM public.google_calendar_tokens WHERE user_id=p_actor AND id=p_token_id AND updated_at=p_token_updated_at) THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
   -- No dispatch has been authorized for a prepared create. Holding the same
   -- booking lock makes rebinding atomic against a simultaneous start claim.
   IF r.calendar_id IS DISTINCT FROM p_calendar AND (r.action<>'create' OR EXISTS(SELECT 1 FROM public.booking_calendar_events WHERE user_id=p_actor AND booking_id=p_booking)) THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
   UPDATE public.calendar_sync_operations SET calendar_id=p_calendar,token_id=p_token_id,token_updated_at=p_token_updated_at WHERE id=r.id RETURNING * INTO r;
  ELSIF r.calendar_id IS DISTINCT FROM p_calendar THEN
   RETURN jsonb_build_object('state','connection_changed');
  END IF;
  RETURN to_jsonb(r);
 END IF;
 SELECT * INTO r FROM public.calendar_sync_operations WHERE actor_id=p_actor AND booking_id=p_booking AND state<>'succeeded';
 IF FOUND THEN RETURN jsonb_build_object('state','busy','id',r.id,'kind',r.kind); END IF;
 SELECT * INTO m FROM public.booking_calendar_events WHERE user_id=p_actor AND booking_id=p_booking FOR UPDATE;
 has_map:=FOUND;
 IF NOT (p_kind='delete' AND NOT has_map) THEN
  IF p_calendar IS NULL OR p_calendar='' OR p_calendar='primary' OR NOT EXISTS(SELECT 1 FROM public.google_calendar_tokens WHERE user_id=p_actor AND id=p_token_id AND updated_at=p_token_updated_at) THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
  IF has_map AND (m.google_event_id='' OR m.calendar_id='' OR (m.calendar_id<>'primary' AND m.calendar_id<>p_calendar)) THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
 END IF;
 IF p_kind='sync' AND (p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>16000 OR NOT(p_payload ?& ARRAY['summary','description','location','start','end','reminders']) OR p_payload-ARRAY['summary','description','location','start','end','reminders']<>'{}'::jsonb) THEN RETURN jsonb_build_object('state','conflict'); END IF;
 INSERT INTO public.calendar_sync_operations(id,booking_id,actor_id,kind,action,state,calendar_id,google_event_id,payload,mapping_id,mapping_synced_at,mapping_calendar_id,token_id,token_updated_at)
 VALUES(p_id,p_booking,p_actor,p_kind,CASE WHEN p_kind='delete' THEN CASE WHEN has_map THEN 'delete' ELSE 'noop' END WHEN has_map THEN 'update' ELSE 'create' END,CASE WHEN p_kind='delete' AND NOT has_map THEN 'succeeded' ELSE 'prepared' END,p_calendar,CASE WHEN has_map THEN m.google_event_id WHEN p_kind='sync' THEN 'cl'||replace(gen_random_uuid()::text,'-','') ELSE NULL END,CASE WHEN p_kind='sync' THEN p_payload ELSE '{}'::jsonb END,m.id,m.synced_at,m.calendar_id,p_token_id,p_token_updated_at)
 ON CONFLICT(id) DO NOTHING RETURNING * INTO r;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','conflict'); END IF;
 RETURN to_jsonb(r);
END; $$;

-- A grant is bound to the exact credential and primary observed by this caller.
DROP FUNCTION public.start_calendar_operation(uuid,uuid);
CREATE FUNCTION public.start_calendar_operation(p_id uuid,p_actor uuid,p_calendar text,p_token_id uuid,p_token_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.calendar_sync_operations%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.calendar_sync_operations WHERE id=p_id AND actor_id=p_actor;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','conflict'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor FOR KEY SHARE;
 PERFORM 1 FROM public.bookings WHERE id=r.booking_id AND user_id=p_actor FOR KEY SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-calendar:'||p_actor::text||':'||r.booking_id::text,0));
 SELECT * INTO r FROM public.calendar_sync_operations WHERE id=p_id FOR UPDATE;
 IF r.state<>'prepared' THEN RETURN to_jsonb(r)||jsonb_build_object('dispatch',false); END IF;
 IF r.calendar_id IS DISTINCT FROM p_calendar OR r.token_id IS DISTINCT FROM p_token_id OR r.token_updated_at IS DISTINCT FROM p_token_updated_at THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
 PERFORM 1 FROM public.google_calendar_tokens WHERE user_id=p_actor AND id=r.token_id AND updated_at=r.token_updated_at FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','connection_changed'); END IF;
 UPDATE public.calendar_sync_operations SET state='started' WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r)||jsonb_build_object('dispatch',true);
END; $$;

REVOKE ALL ON FUNCTION public.start_calendar_operation(uuid,uuid,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_calendar_operation(uuid,uuid,text,uuid,timestamptz) TO service_role;
