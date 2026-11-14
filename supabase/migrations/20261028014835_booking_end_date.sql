DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END $guard$;

-- NULL retains the legacy same-day interpretation; no old row is rewritten.
ALTER TABLE public.bookings ADD COLUMN end_date date;
ALTER TABLE public.bookings ADD CONSTRAINT booking_explicit_end_date_valid CHECK (
  end_date IS NULL OR (
    end_date BETWEEN booking_date AND booking_date + 1
    AND end_date + end_time > booking_date + start_time
    AND end_date + end_time <= booking_date + start_time + interval '8 hours'
  )
);

-- Shared half-open interval primitive for cross-day conflict checks. Invalid
-- intervals fail closed; callers must restrict the booking search to the
-- candidate's adjacent days before invoking it.
CREATE FUNCTION public.booking_intervals_conflict(
  p_start timestamp, p_end timestamp, p_other_start timestamp, p_other_end timestamp, p_buffer_minutes integer
) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN p_start IS NULL OR p_end IS NULL OR p_other_start IS NULL OR p_other_end IS NULL
      OR p_start >= p_end OR p_other_start >= p_other_end OR p_buffer_minutes IS NULL
      OR p_buffer_minutes NOT BETWEEN 0 AND 120 THEN true
    ELSE p_start < p_other_end + pg_catalog.make_interval(mins => p_buffer_minutes)
      AND p_end + pg_catalog.make_interval(mins => p_buffer_minutes) > p_other_start END;
$$;
REVOKE ALL ON FUNCTION public.booking_intervals_conflict(timestamp,timestamp,timestamp,timestamp,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_intervals_conflict(timestamp,timestamp,timestamp,timestamp,integer) TO service_role;

-- A single reservation must be covered continuously by the same staff member
-- on both calendar days, with each day's override applied independently.
CREATE FUNCTION public.booking_staff_works_interval(
  p_staff_id uuid, p_date date, p_start time, p_end_date date, p_end time
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_staff_id IS NULL OR p_date IS NULL OR p_start IS NULL OR p_end_date IS NULL OR p_end IS NULL
    OR p_start = time '24:00' OR p_end_date NOT BETWEEN p_date AND p_date + 1
    OR p_end_date + p_end <= p_date + p_start
    OR p_end_date + p_end > p_date + p_start + interval '8 hours' THEN RETURN false; END IF;
  IF p_end_date = p_date THEN
    RETURN public.booking_staff_works_slot(p_staff_id,p_date,p_start,p_end);
  END IF;
  IF NOT public.booking_staff_works_slot(p_staff_id,p_date,p_start,time '24:00') THEN RETURN false; END IF;
  IF p_end = time '00:00' THEN RETURN true; END IF;
  RETURN public.booking_staff_works_slot(p_staff_id,p_end_date,time '00:00',p_end);
END $$;
REVOKE ALL ON FUNCTION public.booking_staff_works_interval(uuid,date,time,date,time) FROM PUBLIC,anon,authenticated;

-- Callers hold the facility schedule lock across availability and mutation.
-- The bounded scan includes bookings from the preceding day, because their
-- interval or cleanup buffer may continue into the candidate day.
CREATE FUNCTION public.booking_staff_interval_conflict(
  p_facility_id uuid, p_staff_id uuid, p_date date, p_start time,
  p_end_date date, p_end time, p_buffer_minutes integer, p_exclude_booking_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN p_facility_id IS NULL OR p_staff_id IS NULL OR p_date IS NULL OR p_start IS NULL
    OR p_end_date IS NULL OR p_end IS NULL OR p_start = time '24:00'
    OR p_end_date NOT BETWEEN p_date AND p_date + 1 OR p_buffer_minutes IS NULL OR p_buffer_minutes NOT BETWEEN 0 AND 120
    OR p_end_date + p_end <= p_date + p_start OR p_end_date + p_end > p_date + p_start + interval '8 hours'
    THEN true ELSE EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.facility_id = p_facility_id AND b.staff_id = p_staff_id
        AND b.booking_date BETWEEN p_date - 1 AND p_end_date
        AND b.id IS DISTINCT FROM p_exclude_booking_id
        AND b.status NOT IN ('cancelled','no_show','cancel_fee_paid')
        AND public.booking_intervals_conflict(p_date + p_start, p_end_date + p_end,
          b.booking_date + b.start_time, COALESCE(b.end_date,b.booking_date) + b.end_time, p_buffer_minutes)
    ) END;
$$;
REVOKE ALL ON FUNCTION public.booking_staff_interval_conflict(uuid,uuid,date,time,date,time,integer,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.booking_needs_any_staff_interval(
  p_staff_id uuid, p_auto_assigned boolean, p_facility_id uuid,
  p_date date, p_start time, p_end_date date, p_end time
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_staff_id IS NULL OR (p_auto_assigned IS TRUE AND NOT (
    EXISTS(SELECT 1 FROM public.staff_profiles s WHERE s.id=p_staff_id AND s.facility_id=p_facility_id AND s.is_active)
    AND public.booking_staff_works_interval(p_staff_id,p_date,p_start,p_end_date,p_end)
  ));
$$;
REVOKE ALL ON FUNCTION public.booking_needs_any_staff_interval(uuid,boolean,uuid,date,time,date,time) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.booking_unassigned_interval_capacity_full(
  p_facility_id uuid, p_date date, p_start time, p_end_date date, p_end time,
  p_buffer_minutes integer, p_exclude_booking_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN p_facility_id IS NULL OR p_date IS NULL OR p_start IS NULL OR p_end_date IS NULL OR p_end IS NULL
    OR p_start = time '24:00' OR p_end_date NOT BETWEEN p_date AND p_date+1
    OR p_end_date + p_end <= p_date + p_start OR p_end_date + p_end > p_date + p_start + interval '8 hours'
    OR p_buffer_minutes IS NULL OR p_buffer_minutes NOT BETWEEN 0 AND 120 THEN true ELSE (
      WITH matched_bookings AS MATERIALIZED (
        SELECT b.staff_id,b.staff_auto_assigned,b.facility_id,b.booking_date,b.start_time,b.end_date,b.end_time
        FROM public.bookings b WHERE b.facility_id=p_facility_id
          AND b.booking_date BETWEEN p_date-1 AND p_end_date
          AND b.status NOT IN ('cancelled','no_show','cancel_fee_paid')
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.booking_intervals_conflict(p_date+p_start,p_end_date+p_end,
            b.booking_date+b.start_time,COALESCE(b.end_date,b.booking_date)+b.end_time,p_buffer_minutes)
      )
      SELECT EXISTS (SELECT 1 FROM matched_bookings b WHERE public.booking_needs_any_staff_interval(
        b.staff_id,b.staff_auto_assigned,b.facility_id,b.booking_date,b.start_time,COALESCE(b.end_date,b.booking_date),b.end_time))
        AND (SELECT count(*) FROM matched_bookings) >= (SELECT count(*) FROM public.staff_profiles s
          WHERE s.facility_id=p_facility_id AND s.is_active
            AND public.booking_staff_works_interval(s.id,p_date,p_start,p_end_date,p_end))
    ) END;
$$;
REVOKE ALL ON FUNCTION public.booking_unassigned_interval_capacity_full(uuid,date,time,date,time,integer,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.booking_pick_free_staff_interval(
  p_facility_id uuid, p_date date, p_start time, p_end_date date, p_end time, p_buffer_minutes integer,
  p_menu_ids uuid[], p_exclude_booking_id uuid, p_prefer_staff_id uuid
) RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.id FROM public.staff_profiles s
  WHERE s.facility_id=p_facility_id AND s.is_active
    AND public.booking_staff_works_interval(s.id,p_date,p_start,p_end_date,p_end)
    AND NOT public.booking_staff_interval_conflict(p_facility_id,s.id,p_date,p_start,p_end_date,p_end,p_buffer_minutes,p_exclude_booking_id)
    AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_menu_ids, ARRAY[]::uuid[])) chosen(id)
      WHERE chosen.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.menu_staff m WHERE m.menu_id=chosen.id)
      AND NOT EXISTS(SELECT 1 FROM public.menu_staff m WHERE m.menu_id=chosen.id AND m.staff_id=s.id))
  ORDER BY (s.id IS NOT DISTINCT FROM p_prefer_staff_id) DESC,s.sort_order NULLS LAST,s.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.booking_pick_free_staff_interval(uuid,date,time,date,time,integer,uuid[],uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Existing same-day entry points must also see the tail of a new overnight
-- reservation. NULL end_date continues to mean exactly the legacy expression.
-- Abort rather than deploy if an upstream function changed since review.
DO $legacy_conflicts$
DECLARE r record; definition text; original text; changed integer := 0; needs_changed integer := 0;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY(ARRAY['create_booking_for_menus_atomic','change_booking_atomic',
      'get_available_slots','booking_pick_free_staff','booking_unassigned_capacity_full']) LOOP
    definition := pg_get_functiondef(r.oid); original := definition;
    definition := replace(definition, 'b.booking_date + b.end_time', 'COALESCE(b.end_date,b.booking_date) + b.end_time');
    definition := replace(definition, 'booking_date + end_time', 'COALESCE(end_date,booking_date) + end_time');
    IF strpos(definition, 'public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time)') > 0 THEN
      definition := replace(definition,
        'public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time)',
        '(CASE WHEN b.end_date IS NULL THEN public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time) ELSE public.booking_needs_any_staff_interval(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_date, b.end_time) END)');
      needs_changed := needs_changed + 1;
    END IF;
    IF definition <> original THEN EXECUTE definition; changed := changed + 1; END IF;
  END LOOP;
  IF changed <> 5 OR needs_changed <> 2 THEN RAISE EXCEPTION 'overnight conflict function base drift'; END IF;
END $legacy_conflicts$;
