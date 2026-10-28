-- Preserve legacy data and warn before a staff change affects either calendar day.
DO $migration$
DECLARE definition text; old_fragment text; new_fragment text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.replace_staff_schedules_atomic(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure) INTO definition;
  old_fragment := $old$SELECT count(*) INTO affected FROM public.bookings b
      WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id AND b.booking_date>=(now() AT TIME ZONE 'Asia/Tokyo')::date
      AND b.status IN ('pending','confirmed')
      AND NOT EXISTS (SELECT 1 FROM public.schedule_overrides o WHERE o.staff_id=p_staff_id AND o.date=b.booking_date)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_schedules) s
        WHERE (s->>'day_of_week')::int=extract(dow FROM b.booking_date)
          AND b.start_time >= (s->>'start_time')::time AND b.end_time <= (s->>'end_time')::time);$old$;
  new_fragment := $new$SELECT count(*) INTO affected FROM public.bookings b
      WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id
      AND COALESCE(b.end_date,b.booking_date)>=(now() AT TIME ZONE 'Asia/Tokyo')::date
      AND b.status IN ('pending','confirmed')
      AND EXISTS (
        SELECT 1 FROM (VALUES
          (b.booking_date,b.start_time,CASE WHEN COALESCE(b.end_date,b.booking_date)>b.booking_date THEN time '24:00' ELSE b.end_time END),
          (COALESCE(b.end_date,b.booking_date),time '00:00',CASE WHEN COALESCE(b.end_date,b.booking_date)>b.booking_date THEN b.end_time ELSE time '00:00' END)
        ) AS segment(day,starts,ends)
        WHERE segment.starts < segment.ends
          AND (segment.starts <> time '00:00' OR segment.day <> b.booking_date OR b.start_time = time '00:00')
          AND segment.day >= (now() AT TIME ZONE 'Asia/Tokyo')::date
          AND NOT EXISTS (SELECT 1 FROM public.schedule_overrides o WHERE o.staff_id=p_staff_id AND o.date=segment.day)
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_schedules) s
            WHERE (s->>'day_of_week')::int=extract(dow FROM segment.day)
              AND segment.starts >= (s->>'start_time')::time AND segment.ends <= (s->>'end_time')::time));$new$;
  IF strpos(definition,old_fragment)=0 THEN RAISE EXCEPTION 'STAFF_SCHEDULE_DEFINITION_DRIFT'; END IF;
  definition := replace(definition,old_fragment,new_fragment);
  old_fragment := $rule$(s->>'end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'$rule$;
  new_fragment := $rule$(s->>'end_time') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'$rule$;
  IF strpos(definition,old_fragment)=0 THEN RAISE EXCEPTION 'STAFF_SCHEDULE_TIME_RULE_DRIFT'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
  SELECT pg_catalog.pg_get_functiondef('public.save_staff_override_atomic(uuid,uuid,uuid,date,boolean,time without time zone,time without time zone,boolean)'::regprocedure) INTO definition;
  old_fragment := $old$SELECT count(*) INTO affected FROM public.bookings b WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id AND b.booking_date=p_date AND b.status IN ('pending','confirmed')
      AND (p_is_holiday OR (p_start_time IS NOT NULL AND p_end_time IS NOT NULL AND (b.start_time<p_start_time OR b.end_time>p_end_time)));$old$;
  new_fragment := $new$SELECT count(*) INTO affected FROM public.bookings b WHERE b.facility_id=p_facility_id AND b.staff_id=p_staff_id
      AND b.status IN ('pending','confirmed')
      AND (b.booking_date=p_date OR (b.end_date=p_date AND b.booking_date<p_date AND b.end_time>time '00:00'))
      AND (p_is_holiday OR (p_start_time IS NOT NULL AND p_end_time IS NOT NULL AND
        ((CASE WHEN b.booking_date=p_date THEN b.start_time ELSE time '00:00' END)<p_start_time OR
         (CASE WHEN COALESCE(b.end_date,b.booking_date)>p_date THEN time '24:00' ELSE b.end_time END)>p_end_time)));$new$;
  IF strpos(definition,old_fragment)=0 THEN RAISE EXCEPTION 'STAFF_SCHEDULE_DEFINITION_DRIFT'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END;
$migration$;
