-- Add period-aware readers before deploying the writer. No facility data rewrite.
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE FUNCTION public.business_day_periods(p_day jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE a jsonb; p jsonb;
BEGIN
  IF p_day = 'null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  IF p_day IS NULL OR jsonb_typeof(p_day) <> 'object' THEN RETURN NULL; END IF;
  a := CASE WHEN p_day ? 'periods' THEN p_day->'periods' ELSE jsonb_build_array(p_day) END;
  IF jsonb_typeof(a) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(a) NOT BETWEEN 1 AND 12 THEN RETURN NULL; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(a) LOOP
    IF jsonb_typeof(p) IS DISTINCT FROM 'object'
      OR jsonb_typeof(p->'open') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'close') IS DISTINCT FROM 'string'
      OR (p->>'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (p->>'close') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
      OR p->>'open' = p->>'close' THEN RETURN NULL; END IF;
  END LOOP;
  RETURN a;
END $$;

CREATE FUNCTION public.business_day_windows(p_hours jsonb, p_dow integer)
RETURNS TABLE(start_min numeric, end_min numeric)
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE keys text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat']; raw jsonb; a jsonb; p jsonb;
  o numeric; c numeric; offset_day integer; spans numrange[] := ARRAY[]::numrange[];
BEGIN
  IF p_dow IS NULL OR p_dow NOT BETWEEN 0 AND 6 THEN RETURN; END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'object' OR NOT p_hours ? keys[p_dow+1] THEN
    RETURN QUERY SELECT 0::numeric,1440::numeric; RETURN;
  END IF;
  raw := p_hours->keys[p_dow+1];
  -- Preserve the old unconfigured-day fallback; explicit invalid periods fail closed.
  IF raw <> 'null'::jsonb AND (jsonb_typeof(raw) <> 'object' OR
    (NOT raw ? 'periods' AND (raw->>'open' IS NULL OR raw->>'close' IS NULL))) THEN
    RETURN QUERY SELECT 0::numeric,1440::numeric; RETURN;
  END IF;
  IF public.business_day_periods(raw) IS NULL THEN RETURN; END IF;
  FOR offset_day IN 0..1 LOOP
    a := public.business_day_periods(p_hours->keys[((p_dow-offset_day+7)%7)+1]);
    FOR p IN SELECT value FROM jsonb_array_elements(coalesce(a,'[]'::jsonb)) LOOP
      o := extract(epoch FROM (p->>'open')::time)/60;
      c := extract(epoch FROM (p->>'close')::time)/60;
      IF c < o THEN c := c+1440; END IF;
      IF offset_day=0 THEN spans := array_append(spans,numrange(o,least(c,1440),'[)'));
      ELSIF c>1440 THEN spans := array_append(spans,numrange(0,c-1440,'[)')); END IF;
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT lower(r),upper(r) FROM unnest((SELECT range_agg(x) FROM unnest(spans) x)) r;
END $$;

CREATE FUNCTION public.business_interval_fits(p_hours jsonb,p_dow integer,p_start time,p_end time)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(p_end>p_start AND EXISTS(SELECT 1 FROM public.business_day_windows(p_hours,p_dow) w
    WHERE extract(epoch FROM p_start)/60 >= w.start_min AND extract(epoch FROM p_end)/60 <= w.end_min),false);
$$;

CREATE OR REPLACE FUNCTION public.confirmed_booking_hours(p_hours jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE keys text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat']; d integer; a jsonb; p jsonb;
  o numeric; c numeric; span numrange; spans numrange[] := ARRAY[]::numrange[]; count_periods integer := 0;
BEGIN
  IF p_hours IS NULL OR jsonb_typeof(p_hours)<>'object' THEN RETURN false; END IF;
  FOR d IN 0..6 LOOP
    IF NOT p_hours ? keys[d+1] THEN RETURN false; END IF;
    a := public.business_day_periods(p_hours->keys[d+1]);
    IF a IS NULL THEN RETURN false; END IF;
    FOR p IN SELECT value FROM jsonb_array_elements(a) LOOP
      o := extract(epoch FROM (p->>'open')::time)/60+d*1440;
      c := extract(epoch FROM (p->>'close')::time)/60+d*1440;
      IF c<o THEN c:=c+1440; END IF;
      span:=numrange(o,c,'[)');
      IF EXISTS(SELECT 1 FROM unnest(spans) s WHERE s && span OR s && numrange(o+10080,c+10080,'[)')
        OR s && numrange(o-10080,c-10080,'[)')) THEN RETURN false; END IF;
      spans:=array_append(spans,span); count_periods:=count_periods+1;
    END LOOP;
  END LOOP;
  RETURN count_periods>0;
END $$;

CREATE OR REPLACE FUNCTION public.working_time_meets_business_hours(
  p_hours jsonb,p_dow integer,p_start time,p_end time,p_min_minutes integer
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(p_start IS NOT NULL AND p_end IS NOT NULL AND p_end>p_start AND EXISTS(SELECT 1 FROM public.business_day_windows(p_hours,p_dow) w
    WHERE least(extract(epoch FROM p_end)/60,w.end_min)-greatest(extract(epoch FROM p_start)/60,w.start_min)
      >= least(greatest(coalesce(p_min_minutes,15),15),480)),false);
$$;

REVOKE ALL ON FUNCTION public.business_day_periods(jsonb), public.business_day_windows(jsonb,integer),
  public.business_interval_fits(jsonb,integer,time,time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_day_periods(jsonb), public.business_day_windows(jsonb,integer),
  public.business_interval_fits(jsonb,integer,time,time) TO anon,authenticated,service_role;

-- Preserve authoritative bodies/locks/ACLs. Abort if the expected base has drifted.
DO $patch$
DECLARE r record; definition text; changed integer;
BEGIN
  changed:=0;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_booking_for_menus_atomic' LOOP
    definition:=pg_get_functiondef(r.oid);
    IF strpos(definition,$old$    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;$old$)>0 THEN
      definition:=replace(definition,$old$    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;$old$,$new$    IF NOT public.business_interval_fits(v_business_hours,v_gate_dow,p_start_time,p_end_time) THEN
      IF NOT EXISTS(SELECT 1 FROM public.business_day_windows(v_business_hours,v_gate_dow)) THEN
        RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
      END IF;
      RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
    END IF;$new$);
      EXECUTE definition; changed:=changed+1;
    END IF;
  END LOOP;
  IF changed<>1 THEN RAISE EXCEPTION 'hours gate base drift: create_booking_for_menus_atomic'; END IF;
  changed:=0;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='change_booking_atomic' LOOP
    definition:=pg_get_functiondef(r.oid);
    IF strpos(definition,$old$    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;$old$)>0 THEN
      definition:=replace(definition,$old$    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;$old$,$new$    IF NOT public.business_interval_fits(v_business_hours,v_gate_dow,p_start_time,p_end_time) THEN
      IF NOT EXISTS(SELECT 1 FROM public.business_day_windows(v_business_hours,v_gate_dow)) THEN
        RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
      END IF;
      RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
    END IF;$new$);
      EXECUTE definition; changed:=changed+1;
    END IF;
  END LOOP;
  IF changed<>1 THEN RAISE EXCEPTION 'hours gate base drift: change_booking_atomic'; END IF;
  changed:=0;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_available_slots' LOOP
    definition:=pg_get_functiondef(r.oid);
    IF strpos(definition,$old$  -- #2: 施設営業時間との交差。business_hours[曜日]=null は定休日→枠ゼロ。{open,close} は勤務窓をクランプ。
  -- キー不在・business_hours 未設定はゲートせず従来挙動（既存施設を壊さない）。
  IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
    v_day_key := CASE v_day_of_week
      WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
      WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
    v_day_val := v_business_hours -> v_day_key;
    IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
      IF jsonb_typeof(v_day_val) = 'null' THEN
        RETURN;                                   -- 定休日
      END IF;
      v_fac_open := (v_day_val ->> 'open')::time;
      v_fac_close := (v_day_val ->> 'close')::time;
      IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
        IF v_fac_open > v_work_start THEN v_work_start := v_fac_open; END IF;
        IF v_fac_close < v_work_end THEN v_work_end := v_fac_close; END IF;
      END IF;
    END IF;
  END IF;
$old$)>0 THEN
      definition:=replace(definition,'DECLARE','DECLARE v_window record; v_original_start time; v_original_end time;');
      definition:=replace(definition,$old$  -- #2: 施設営業時間との交差。business_hours[曜日]=null は定休日→枠ゼロ。{open,close} は勤務窓をクランプ。
  -- キー不在・business_hours 未設定はゲートせず従来挙動（既存施設を壊さない）。
  IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
    v_day_key := CASE v_day_of_week
      WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
      WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
    v_day_val := v_business_hours -> v_day_key;
    IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
      IF jsonb_typeof(v_day_val) = 'null' THEN
        RETURN;                                   -- 定休日
      END IF;
      v_fac_open := (v_day_val ->> 'open')::time;
      v_fac_close := (v_day_val ->> 'close')::time;
      IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
        IF v_fac_open > v_work_start THEN v_work_start := v_fac_open; END IF;
        IF v_fac_close < v_work_end THEN v_work_end := v_fac_close; END IF;
      END IF;
    END IF;
  END IF;
$old$,'');
      definition:=replace(definition,$old$  v_current_start := v_work_start;$old$,$new$  v_original_start:=v_work_start; v_original_end:=v_work_end;
  FOR v_window IN SELECT * FROM public.business_day_windows(v_business_hours,v_day_of_week) LOOP
    v_work_start:=greatest(v_original_start,('00:00'::time+make_interval(mins=>v_window.start_min::integer)));
    v_work_end:=least(v_original_end,CASE WHEN v_window.end_min=1440 THEN '24:00'::time
      ELSE '00:00'::time+make_interval(mins=>v_window.end_min::integer) END);
  v_current_start := v_work_start;$new$);
      definition:=replace(definition,E'  END LOOP;\nEND;',E'  END LOOP;\n  END LOOP;\nEND;');
      definition:=replace(definition,$old$v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;$old$,$new$v_current_end := CASE WHEN extract(epoch FROM v_current_start)+p_duration_minutes*60=86400 THEN '24:00'::time ELSE v_current_start + make_interval(mins=>p_duration_minutes) END;$new$);
      definition:=replace(definition,$old$EXIT WHEN v_work_end - v_current_start < interval '30 minutes';$old$,$new$EXIT WHEN extract(epoch FROM v_current_start)+1800>=86400 OR v_work_end - v_current_start < interval '30 minutes';$new$);
      EXECUTE definition; changed:=changed+1;
    END IF;
  END LOOP;
  IF changed<>1 THEN RAISE EXCEPTION 'hours slots base drift'; END IF;
END $patch$;

-- Compare absolute calendar times: TIME arithmetic wraps at midnight. The existing
-- carelink-staff-schedule facility lock in both booking mutations serializes
-- adjacent booking dates too; retain those locks and all authorization checks.
DO $buffers$
DECLARE r record; definition text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['create_booking_for_menus_atomic','change_booking_atomic','get_available_slots','booking_pick_free_staff','booking_unassigned_capacity_full']) LOOP
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,'AND booking_date = p_booking_date','AND booking_date BETWEEN p_booking_date-1 AND p_booking_date+1');
    definition:=replace(definition,'b.booking_date = p_date','b.booking_date BETWEEN p_date-1 AND p_date+1');
    definition:=replace(definition,$old$start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL$old$,$new$booking_date + start_time < p_booking_date + p_end_time + make_interval(mins=>v_buffer_minutes)$new$);
    definition:=replace(definition,$old$end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time$old$,$new$booking_date + end_time + make_interval(mins=>v_buffer_minutes) > p_booking_date + p_start_time$new$);
    definition:=replace(definition,$old$b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL$old$,$new$b.booking_date + b.start_time < p_date + v_current_end + make_interval(mins=>v_buffer_minutes)$new$);
    definition:=replace(definition,$old$b.end_time + (v_buffer_minutes || ' minutes')::INTERVAL > v_current_start$old$,$new$b.booking_date + b.end_time + make_interval(mins=>v_buffer_minutes) > p_date + v_current_start$new$);
    definition:=replace(definition,$old$b.start_time < p_end + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval$old$,$new$b.booking_date + b.start_time < p_date + p_end + make_interval(mins=>coalesce(p_buffer_minutes,0))$new$);
    definition:=replace(definition,$old$b.end_time + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval > p_start$old$,$new$b.booking_date + b.end_time + make_interval(mins=>coalesce(p_buffer_minutes,0)) > p_date + p_start$new$);
    EXECUTE definition;
  END LOOP;
END $buffers$;
