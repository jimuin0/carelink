-- Adding a staff member no longer creates a weekly schedule nobody asked for.
--
-- 【2026年10月22日 神原さん決定】「店舗によって営業時間もシフトも違う」。
-- Before: create_staff_with_schedules_atomic inserted 日〜土 × 09:00〜19:00 for every new
-- staff member (PR#191's "予約枠ゼロでは立ち上げられない" stopgap). The insert never read the
-- shop's business hours, so slots after 19:00 / before 09:00 silently disappeared, the
-- staff member's real days off were bookable on the shop's open days, and the setup
-- checklist 「予約枠：勤務スケジュール設定」 turned complete by itself.
--
-- After: the RPC creates only the staff profile and its replay receipt. The admin UI
-- opens the staff member's schedule editor right after creation, pre-filled from THIS
-- shop's confirmed business hours as an unsaved suggestion; replace_staff_schedules_atomic
-- writes it only when the owner saves. Until then the staff member has no weekly schedule,
-- takes no bookings (get_available_slots / create_*_booking_atomic already require a
-- staff_schedules row), and the setup checklist stays incomplete.
--
-- Body is the 20261008080210 definition (the latest; no later migration replaces or
-- patches it) minus the staff_schedules INSERT. Signature, SECURITY INVOKER,
-- search_path, the lock order and the receipt are unchanged, so the current app keeps
-- working unmodified when this is applied before the new app is deployed (it simply
-- stops getting the silent default).
--
-- Existing staff_schedules rows are not touched (no data migration).
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.create_staff_with_schedules_atomic(
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
  -- No staff_schedules row here: the weekly schedule is written only when the owner
  -- saves it (replace_staff_schedules_atomic).
  result:=jsonb_build_object('staff',to_jsonb(staff),'replayed',false);
  INSERT INTO public.staff_mutation_operations(operation_id,actor_id,facility_id,staff_id,kind,input_digest,result)
    VALUES(p_operation_id,p_actor_id,p_facility_id,staff.id,'create',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'),jsonb_build_object('staff_id',staff.id));
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_with_schedules_atomic(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_with_schedules_atomic(uuid,uuid,uuid,jsonb) TO service_role;
