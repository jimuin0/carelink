-- R09/R20: business writes and replay receipts share one transaction.
-- Receipts store a SHA256 of canonical input, never staff name/bio.
-- Receipts are tombstones: deleting a staff member never allows replay to create it again.
CREATE TABLE public.staff_mutation_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create','weekly')),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_mutation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mutation_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.staff_mutation_operations TO service_role;

CREATE FUNCTION public.create_staff_with_schedules_atomic(
  p_actor_id uuid, p_facility_id uuid, p_operation_id uuid, p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  prior public.staff_mutation_operations%ROWTYPE;
  staff public.staff_profiles%ROWTYPE;
  result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_operation_id IS NULL
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['name','position','bio','specialties','years_experience','instagram_url','nomination_fee','line_works_channel_id','line_works_notify_all'] <> '{}'::jsonb
  THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-operation:' || p_operation_id::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM public.staff_mutation_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF prior.actor_id<>p_actor_id OR prior.facility_id<>p_facility_id OR prior.kind<>'create' OR prior.input_digest<>encode(sha256(convert_to(p_input::text,'UTF8')),'hex')
      THEN RAISE EXCEPTION 'STAFF_OPERATION_CONFLICT'; END IF;
    SELECT * INTO staff FROM public.staff_profiles WHERE id=prior.staff_id AND facility_id=p_facility_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_OPERATION_RETIRED'; END IF;
    RETURN jsonb_build_object('staff',to_jsonb(staff),'replayed',true);
  END IF;
  IF jsonb_typeof(p_input->'name') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 50
    OR EXISTS (SELECT 1 FROM jsonb_each(p_input) e WHERE e.key IN ('position','bio','instagram_url','line_works_channel_id') AND jsonb_typeof(e.value) NOT IN ('string','null'))
    OR length(p_input->>'position')>50 OR length(p_input->>'bio')>500 OR length(p_input->>'instagram_url')>200 OR length(p_input->>'line_works_channel_id')>50
    OR (p_input ? 'line_works_notify_all' AND jsonb_typeof(p_input->'line_works_notify_all')<>'boolean')
    OR (p_input ? 'years_experience' AND jsonb_typeof(p_input->'years_experience') NOT IN ('number','null'))
    OR (p_input ? 'nomination_fee' AND jsonb_typeof(p_input->'nomination_fee')<>'number')
    OR (p_input ? 'specialties' AND jsonb_typeof(p_input->'specialties')<>'array')
  THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  IF COALESCE((p_input->>'nomination_fee')::numeric,0) NOT BETWEEN 0 AND 99999
    OR trunc(COALESCE((p_input->>'nomination_fee')::numeric,0))<>COALESCE((p_input->>'nomination_fee')::numeric,0)
    OR (p_input->>'years_experience')::numeric NOT BETWEEN 0 AND 99
    OR trunc((p_input->>'years_experience')::numeric)<>(p_input->>'years_experience')::numeric
    OR jsonb_array_length(COALESCE(p_input->'specialties','[]'::jsonb))>20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_input->'specialties','[]'::jsonb)) s WHERE jsonb_typeof(s)<>'string' OR length(s #>> '{}')>50)
  THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  INSERT INTO public.staff_profiles(facility_id,name,slug,position,bio,specialties,years_experience,instagram_url,nomination_fee,line_works_channel_id,line_works_notify_all,is_active)
    VALUES(p_facility_id,btrim(p_input->>'name'),'staff-' || p_operation_id::text,p_input->>'position',p_input->>'bio',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_input->'specialties','[]'::jsonb))),
      (p_input->>'years_experience')::int,NULLIF(p_input->>'instagram_url',''),COALESCE((p_input->>'nomination_fee')::int,0),
      p_input->>'line_works_channel_id',COALESCE((p_input->>'line_works_notify_all')::boolean,false),true)
    RETURNING * INTO staff;
  INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time)
    SELECT staff.id,day,'09:00'::time,'19:00'::time FROM generate_series(0,6) day;
  result:=jsonb_build_object('staff',to_jsonb(staff),'replayed',false);
  INSERT INTO public.staff_mutation_operations(operation_id,actor_id,facility_id,staff_id,kind,input_digest,result)
    VALUES(p_operation_id,p_actor_id,p_facility_id,staff.id,'create',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'),jsonb_build_object('staff_id',staff.id));
  RETURN result;
END;
$$;

CREATE FUNCTION public.replace_staff_schedules_atomic(
  p_actor_id uuid, p_facility_id uuid, p_staff_id uuid, p_operation_id uuid, p_schedules jsonb, p_force boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prior public.staff_mutation_operations%ROWTYPE; input jsonb; affected int; result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_staff_id IS NULL OR p_operation_id IS NULL OR p_force IS NULL
    OR jsonb_typeof(p_schedules) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  IF jsonb_array_length(p_schedules)>7 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_schedules) s WHERE jsonb_typeof(s)<>'object'
      OR s - ARRAY['day_of_week','start_time','end_time'] <> '{}'::jsonb
      OR jsonb_typeof(s->'day_of_week') IS DISTINCT FROM 'number'
      OR (s->>'day_of_week') !~ '^[0-6]$'
      OR jsonb_typeof(s->'start_time') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'end_time') IS DISTINCT FROM 'string'
      OR (s->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (s->>'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (s->>'start_time') >= (s->>'end_time'))
    OR (SELECT count(DISTINCT s->>'day_of_week') FROM jsonb_array_elements(p_schedules) s) <> jsonb_array_length(p_schedules)
  THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  input:=jsonb_build_object('schedules',p_schedules,'force',p_force);
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-operation:' || p_operation_id::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  SELECT * INTO prior FROM public.staff_mutation_operations WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF prior.actor_id<>p_actor_id OR prior.facility_id<>p_facility_id OR prior.staff_id<>p_staff_id OR prior.kind<>'weekly' OR prior.input_digest<>encode(sha256(convert_to(input::text,'UTF8')),'hex')
      THEN RAISE EXCEPTION 'STAFF_OPERATION_CONFLICT'; END IF;
    RETURN prior.result || jsonb_build_object('replayed',true);
  END IF;
  -- The booking insertion/change RPCs acquire the same facility lock BEFORE their
  -- schedule check. Consequently this is the final authoritative impact check.
  IF NOT p_force THEN
    SELECT count(*) INTO affected FROM public.bookings b
      WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id AND b.booking_date>=(now() AT TIME ZONE 'Asia/Tokyo')::date
      AND b.status IN ('pending','confirmed')
      AND NOT EXISTS (SELECT 1 FROM public.schedule_overrides o WHERE o.staff_id=p_staff_id AND o.date=b.booking_date)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_schedules) s
        WHERE (s->>'day_of_week')::int=extract(dow FROM b.booking_date)
          AND b.start_time >= (s->>'start_time')::time AND b.end_time <= (s->>'end_time')::time);
    IF affected>0 THEN RETURN jsonb_build_object('code','BOOKINGS_AFFECTED','affectedBookings',affected); END IF;
  END IF;
  DELETE FROM public.staff_schedules WHERE staff_id=p_staff_id;
  INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time)
    SELECT p_staff_id,(s->>'day_of_week')::int,(s->>'start_time')::time,(s->>'end_time')::time FROM jsonb_array_elements(p_schedules) s;
  result:=jsonb_build_object('ok',true,'replayed',false);
  INSERT INTO public.staff_mutation_operations(operation_id,actor_id,facility_id,staff_id,kind,input_digest,result)
    VALUES(p_operation_id,p_actor_id,p_facility_id,p_staff_id,'weekly',encode(sha256(convert_to(input::text,'UTF8')),'hex'),result);
  RETURN result;
END;
$$;

CREATE FUNCTION public.save_staff_override_atomic(p_actor_id uuid,p_facility_id uuid,p_staff_id uuid,p_date date,p_is_holiday boolean,p_start_time time,p_end_time time,p_force boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE affected int;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_staff_id IS NULL OR p_date IS NULL OR p_is_holiday IS NULL OR p_force IS NULL
    OR (NOT p_is_holiday AND ((p_start_time IS NULL) <> (p_end_time IS NULL)))
    OR (p_start_time IS NOT NULL AND p_end_time IS NOT NULL AND p_start_time>=p_end_time)
    THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  IF NOT p_force THEN
    SELECT count(*) INTO affected FROM public.bookings b WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id AND b.booking_date=p_date AND b.status IN ('pending','confirmed')
      AND (p_is_holiday OR (p_start_time IS NOT NULL AND p_end_time IS NOT NULL AND (b.start_time<p_start_time OR b.end_time>p_end_time)));
    IF affected>0 THEN RETURN jsonb_build_object('code','BOOKINGS_AFFECTED','affectedBookings',affected); END IF;
  END IF;
  INSERT INTO public.schedule_overrides(staff_id,date,is_holiday,start_time,end_time)
    VALUES(p_staff_id,p_date,p_is_holiday,CASE WHEN p_is_holiday THEN NULL ELSE p_start_time END,CASE WHEN p_is_holiday THEN NULL ELSE p_end_time END)
    ON CONFLICT(staff_id,date) DO UPDATE SET is_holiday=EXCLUDED.is_holiday,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE FUNCTION public.delete_staff_override_atomic(p_actor_id uuid,p_facility_id uuid,p_staff_id uuid,p_override_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_staff_id IS NULL OR p_override_id IS NULL THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND'; END IF;
  DELETE FROM public.schedule_overrides WHERE id=p_override_id AND staff_id=p_staff_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.create_staff_with_schedules_atomic(uuid,uuid,uuid,jsonb),
  public.replace_staff_schedules_atomic(uuid,uuid,uuid,uuid,jsonb,boolean),
  public.save_staff_override_atomic(uuid,uuid,uuid,date,boolean,time,time,boolean),
  public.delete_staff_override_atomic(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_with_schedules_atomic(uuid,uuid,uuid,jsonb),
  public.replace_staff_schedules_atomic(uuid,uuid,uuid,uuid,jsonb,boolean),
  public.save_staff_override_atomic(uuid,uuid,uuid,date,boolean,time,time,boolean),
  public.delete_staff_override_atomic(uuid,uuid,uuid,uuid) TO service_role;

-- Reload recovery discloses only state/target, never staff input or another actor's operation.
CREATE FUNCTION public.get_staff_mutation_operation(p_actor_id uuid,p_facility_id uuid,p_operation_id uuid,p_kind text,p_staff_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.staff_mutation_operations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_operation_id IS NULL OR p_kind NOT IN ('create','weekly') OR p_kind IS NULL
    OR (p_kind='weekly' AND p_staff_id IS NULL) THEN RAISE EXCEPTION 'STAFF_INPUT_INVALID'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-operation:' || p_operation_id::text,0));
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM public.staff_mutation_operations WHERE operation_id=p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  IF prior.actor_id<>p_actor_id OR prior.facility_id<>p_facility_id OR prior.kind<>p_kind OR (p_kind='weekly' AND prior.staff_id<>p_staff_id)
    THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id=prior.staff_id AND facility_id=p_facility_id)
    THEN RETURN jsonb_build_object('state','retired'); END IF;
  RETURN jsonb_build_object('state','saved','staff_id',prior.staff_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_staff_mutation_operation(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_mutation_operation(uuid,uuid,uuid,text,uuid) TO service_role;

-- Preserve current authoritative booking bodies and grants. Insert the common
-- schedule lock before any day lock or schedule read, including outer wrappers.
-- A role-revocation writer already owns its member row before the AFTER
-- last-owner trigger runs. Its non-key status update must not conflict with
-- a booking's parent KEY SHARE while that booking waits for the same member.
-- Auth's active-booking/retirement guard keeps its stronger parent protection.
DO $$
DECLARE definition text; old text := 'WHERE id=OLD.facility_id FOR UPDATE;';
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.suspend_last_owned_facility()'::regprocedure);
  IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1
    THEN RAISE EXCEPTION 'STAFF_OWNER_LOCK_FORWARD_UPDATE_MISMATCH'; END IF;
  EXECUTE replace(definition,old,'WHERE id=OLD.facility_id FOR NO KEY UPDATE;');
END;
$$;

DO $$
DECLARE definition text; signature text; old text; replacement text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,boolean)',
    'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)',
    'public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[])',
    'public.create_manual_booking_atomic(uuid,uuid,jsonb)'
  ] LOOP
    definition:=pg_catalog.pg_get_functiondef(signature::regprocedure);
    CASE
      WHEN signature LIKE '%create_booking_atomic(%' THEN
        old:='  v_lock_key := (''x'' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;';
        replacement:='  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''carelink-staff-schedule:'' || p_facility_id::text,0));' || chr(10) || old;
      WHEN signature LIKE '%change_booking_atomic(%' THEN
        old:='  v_lock_key := (''x'' || left(md5(v_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;';
        replacement:='  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''carelink-staff-schedule:'' || v_facility_id::text,0));' || chr(10) || old;
      WHEN signature LIKE '%create_online_booking_atomic(%' THEN
        old:='  PERFORM public.lock_booking_account(p_user_id);';
        replacement:=old || chr(10) || '  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''carelink-staff-schedule:'' || p_facility_id::text,0));';
      ELSE
        old:='  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''manual-booking:'' || p_operation_id::text, 0));';
        replacement:='  PERFORM public.lock_booking_account(p_actor_id);' || chr(10) || old;
    END CASE;
    IF strpos(definition,old)=0 OR (length(definition)-length(replace(definition,old,'')))/length(old)<>1
      THEN RAISE EXCEPTION 'STAFF_LOCK_FORWARD_UPDATE_MISMATCH: %', signature; END IF;
    definition:=replace(definition,old,replacement);
    IF signature LIKE '%create_manual_booking_atomic(%' THEN
      old:='  PERFORM 1 FROM public.facility_members';
      IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'STAFF_LOCK_FORWARD_UPDATE_MISMATCH: %',signature; END IF;
      definition:=replace(definition,old,'  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''carelink-staff-schedule:'' || v_facility::text,0));' || chr(10) || '  PERFORM 1 FROM public.facility_profiles WHERE id=v_facility FOR KEY SHARE;' || chr(10) || old);
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$$;
