-- M01/M02. Keep the operation tombstone even after a reservation is removed.
-- No original records are rewritten, and no external messages are sent here.
CREATE TABLE public.manual_booking_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  booking_id uuid NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_booking_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_booking_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.manual_booking_operations TO service_role;

CREATE FUNCTION public.create_manual_booking_atomic(p_actor_id uuid, p_operation_id uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_facility uuid;
  v_staff uuid;
  v_date date;
  v_start time;
  v_end time;
  v_menus uuid[];
  v_menu_count int;
  v_price bigint;
  v_staff_fee int := 0;
  v_staff_name text;
  v_facility_name text;
  v_menu_names text;
  v_booking uuid;
  v_result jsonb;
  v_prior public.manual_booking_operations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_operation_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['facility_id','staff_id','menu_ids','booking_date','start_time','end_time','customer_name','email','phone','note'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'facility_id') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  v_facility := (p_input->>'facility_id')::uuid;
  -- Operation -> current authorization -> original result -> facility/date ->
  -- input rows. The date lock is exactly the core booking RPC's lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('manual-booking:' || p_operation_id::text, 0));
  PERFORM 1 FROM public.facility_members
    WHERE user_id = p_actor_id AND facility_id = v_facility AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_prior FROM public.manual_booking_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_prior.actor_id <> p_actor_id OR v_prior.facility_id <> v_facility OR v_prior.input <> p_input
      THEN RAISE EXCEPTION 'MANUAL_OPERATION_CONFLICT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = v_prior.booking_id AND facility_id = v_facility)
      THEN RAISE EXCEPTION 'MANUAL_OPERATION_RETIRED'; END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', true);
  END IF;
  IF (p_input->>'booking_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR (p_input->>'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR (p_input->>'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR jsonb_typeof(p_input->'booking_date') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'start_time') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'end_time') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'customer_name') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'customer_name')) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_input->'menu_ids') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  IF jsonb_array_length(p_input->'menu_ids') NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_input->'menu_ids') AS m(value) WHERE jsonb_typeof(value) <> 'string')
  THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  SELECT array_agg(value::uuid ORDER BY ordinal) INTO v_menus
    FROM jsonb_array_elements_text(p_input->'menu_ids') WITH ORDINALITY AS m(value, ordinal);
  IF cardinality(v_menus) <> (SELECT count(DISTINCT m) FROM unnest(v_menus) m)
    THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_input) e WHERE e.key IN ('email','phone','note','staff_id')
    AND jsonb_typeof(e.value) NOT IN ('string','null'))
    OR length(p_input->>'email') > 254 OR length(p_input->>'phone') > 20 OR length(p_input->>'note') > 500
  THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  v_staff := (p_input->>'staff_id')::uuid;
  v_date := (p_input->>'booking_date')::date;
  v_start := (p_input->>'start_time')::time;
  v_end := (p_input->>'end_time')::time;
  IF v_start >= v_end THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(('x' || left(md5(v_facility::text || v_date::text), 16))::bit(64)::bigint);
  SELECT name INTO v_facility_name FROM public.facility_profiles WHERE id = v_facility FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_FACILITY_UNAVAILABLE'; END IF;
  PERFORM id FROM public.facility_menus WHERE facility_id = v_facility AND id = ANY(v_menus) ORDER BY id FOR SHARE;
  SELECT count(*), sum(COALESCE(price, 0)) INTO v_menu_count, v_price FROM public.facility_menus
    WHERE facility_id = v_facility AND id = ANY(v_menus);
  IF v_menu_count <> cardinality(v_menus) THEN RAISE EXCEPTION 'MANUAL_MENU_UNAVAILABLE'; END IF;
  SELECT string_agg(m.name, '、' ORDER BY chosen.ordinal) INTO v_menu_names
    FROM unnest(v_menus) WITH ORDINALITY AS chosen(id, ordinal)
    JOIN public.facility_menus m ON m.id = chosen.id AND m.facility_id = v_facility;
  IF v_staff IS NOT NULL THEN
    SELECT name, COALESCE(nomination_fee, 0) INTO v_staff_name, v_staff_fee
      FROM public.staff_profiles WHERE id = v_staff AND facility_id = v_facility FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_STAFF_UNAVAILABLE'; END IF;
  END IF;
  v_price := v_price + v_staff_fee;
  IF v_price < 0 OR v_price > 2147483647 THEN RAISE EXCEPTION 'MANUAL_PRICE_INVALID'; END IF;
  v_booking := public.create_booking_atomic(v_facility, v_staff, NULL, v_menus[1], NULL,
    v_date, v_start, v_end, p_input->>'customer_name', p_input->>'email', p_input->>'phone',
    p_input->>'note', v_price::int, 0, 'confirmed', false);
  UPDATE public.bookings SET menu_ids = v_menus WHERE id = v_booking AND facility_id = v_facility;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_SAVE_FAILED'; END IF;
  v_result := jsonb_build_object('booking_id', v_booking, 'replayed', false,
    'total_price', v_price, 'menu_names', v_menu_names, 'staff_name', v_staff_name, 'facility_name', v_facility_name);
  INSERT INTO public.manual_booking_operations(operation_id, actor_id, facility_id, input, booking_id, result)
    VALUES(p_operation_id, p_actor_id, v_facility, p_input, v_booking, v_result);
  -- The business commit must not precede its notification reservation. The
  -- operation UUID is also the unique outbox ID; replay cannot enqueue again.
  IF NULLIF(p_input->>'email','') IS NOT NULL THEN
    INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload)
      VALUES(p_operation_id,'manual_booking_confirmation',p_operation_id::text,v_facility,
        jsonb_build_object('operation_id',p_operation_id,'template_version',1));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_booking_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_booking_atomic(uuid, uuid, jsonb) TO service_role;

-- Read-only recovery after browser reload. Serialize with the original create
-- transaction; disclose no customer data, and check current membership again.
CREATE FUNCTION public.get_manual_booking_operation(p_actor_id uuid, p_operation_id uuid, p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prior public.manual_booking_operations%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_operation_id IS NULL OR p_facility_id IS NULL
    THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('manual-booking:' || p_operation_id::text, 0));
  PERFORM 1 FROM public.facility_members WHERE user_id = p_actor_id AND facility_id = p_facility_id
    AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_prior FROM public.manual_booking_operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  IF v_prior.actor_id <> p_actor_id OR v_prior.facility_id <> p_facility_id
    THEN RAISE EXCEPTION 'MANUAL_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = v_prior.booking_id AND facility_id = p_facility_id)
    THEN RETURN jsonb_build_object('state','retired'); END IF;
  RETURN jsonb_build_object('state','saved','booking_id',v_prior.booking_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_manual_booking_operation(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_manual_booking_operation(uuid,uuid,uuid) TO service_role;
