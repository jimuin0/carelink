-- Additive only: existing facilities retain their current hours and behaviour.
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE TABLE public.facility_special_hours (
  facility_id uuid PRIMARY KEY REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  allow_overnight_bookings boolean NOT NULL DEFAULT false,
  close_on_public_holidays boolean NOT NULL DEFAULT false,
  closed_dates date[] NOT NULL DEFAULT '{}',
  reception_cutoff_minutes integer,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT facility_special_hours_cutoff_range CHECK (reception_cutoff_minutes BETWEEN 0 AND 1440),
  CONSTRAINT facility_special_hours_dates_limit CHECK (cardinality(closed_dates) <= 366)
);
ALTER TABLE public.facility_special_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.facility_special_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.facility_special_hours TO service_role;

CREATE FUNCTION public.save_facility_special_hours_atomic(
  p_actor_id uuid, p_facility_id uuid, p_allow_overnight boolean, p_close_on_holidays boolean,
  p_closed_dates date[], p_cutoff_minutes integer, p_expected_updated_at timestamptz,
  p_holiday_dates date[], p_holiday_from date, p_holiday_through date
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_updated_at timestamptz; v_old_dates date[]; v_old_holidays boolean;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_allow_overnight IS NULL OR p_close_on_holidays IS NULL OR p_closed_dates IS NULL
    OR cardinality(p_closed_dates) > 366 OR array_position(p_closed_dates, NULL) IS NOT NULL
    OR (SELECT count(DISTINCT d) FROM unnest(p_closed_dates) d) <> cardinality(p_closed_dates)
    OR (p_cutoff_minutes IS NOT NULL AND p_cutoff_minutes NOT BETWEEN 0 AND 1440)
  THEN RAISE EXCEPTION 'INVALID_SPECIAL_HOURS'; END IF;
  IF p_close_on_holidays AND (p_holiday_dates IS NULL OR cardinality(p_holiday_dates) > 1000
    OR p_holiday_from IS NULL OR p_holiday_through IS NULL OR p_holiday_from > p_holiday_through
    OR array_position(p_holiday_dates, NULL) IS NOT NULL) THEN RAISE EXCEPTION 'HOLIDAY_CALENDAR_UNAVAILABLE'; END IF;

  -- Same lock used by booking/staff mutations. A revoked owner cannot save.
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text, 0));
  PERFORM 1 FROM public.facility_profiles f WHERE f.id = p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id = p_facility_id AND m.user_id = p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  SELECT s.updated_at, s.closed_dates, s.close_on_public_holidays INTO v_updated_at, v_old_dates, v_old_holidays FROM public.facility_special_hours s
    WHERE s.facility_id = p_facility_id FOR UPDATE;
  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'SPECIAL_HOURS_CHANGED'; END IF;

  -- Do not silently make existing reservations inconsistent with a newly
  -- selected closure. A reservation ending at 00:00 does not occupy that date.
  IF EXISTS (
    SELECT 1 FROM unnest(p_closed_dates) AS requested(day)
    JOIN public.bookings b ON b.facility_id = p_facility_id
      AND b.status IN ('pending','confirmed','arrived')
      AND b.booking_date <= requested.day
      AND (COALESCE(b.end_date, b.booking_date) > requested.day
        OR (COALESCE(b.end_date, b.booking_date) = requested.day AND b.end_time > time '00:00'))
    WHERE requested.day >= (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
      AND NOT requested.day = ANY(COALESCE(v_old_dates, ARRAY[]::date[]))
  ) THEN RAISE EXCEPTION 'SPECIAL_HOURS_HAS_BOOKINGS'; END IF;
  IF p_close_on_holidays AND NOT COALESCE(v_old_holidays, false) THEN
    IF EXISTS (SELECT 1 FROM public.bookings b WHERE b.facility_id = p_facility_id
      AND b.status IN ('pending','confirmed','arrived') AND COALESCE(b.end_date,b.booking_date) >= (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
      AND (b.booking_date < p_holiday_from OR COALESCE(b.end_date,b.booking_date) > p_holiday_through))
      THEN RAISE EXCEPTION 'HOLIDAY_CALENDAR_UNAVAILABLE'; END IF;
    IF EXISTS (SELECT 1 FROM public.bookings b JOIN unnest(p_holiday_dates) AS holiday(day)
      ON b.booking_date <= holiday.day AND (COALESCE(b.end_date,b.booking_date) > holiday.day
        OR (COALESCE(b.end_date,b.booking_date) = holiday.day AND b.end_time > time '00:00'))
      WHERE b.facility_id = p_facility_id AND b.status IN ('pending','confirmed','arrived')
        AND holiday.day >= (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date)
      THEN RAISE EXCEPTION 'SPECIAL_HOURS_HAS_BOOKINGS'; END IF;
  END IF;

  INSERT INTO public.facility_special_hours(facility_id, allow_overnight_bookings, close_on_public_holidays, closed_dates, reception_cutoff_minutes)
    VALUES (p_facility_id, p_allow_overnight, p_close_on_holidays, p_closed_dates, p_cutoff_minutes)
  ON CONFLICT (facility_id) DO UPDATE SET allow_overnight_bookings = EXCLUDED.allow_overnight_bookings, close_on_public_holidays = EXCLUDED.close_on_public_holidays,
    closed_dates = EXCLUDED.closed_dates, reception_cutoff_minutes = EXCLUDED.reception_cutoff_minutes,
    updated_at = clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.save_facility_special_hours_atomic(uuid,uuid,boolean,boolean,date[],integer,timestamptz,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_facility_special_hours_atomic(uuid,uuid,boolean,boolean,date[],integer,timestamptz,date[],date,date) TO service_role;
