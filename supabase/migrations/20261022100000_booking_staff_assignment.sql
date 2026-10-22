-- Double booking between おまかせ (no staff named) and named-staff reservations.
--
-- Before: an おまかせ reservation was stored with staff_id NULL and only counted
-- against the facility-wide capacity, while a named reservation only looked at
-- its own staff member's rows. With one working staff member, an おまかせ
-- reservation at 10:00 and a named reservation for that member at 10:00 were
-- both accepted (and get_available_slots kept offering the slot).
--
-- After:
--  * A new おまかせ reservation is assigned a concrete free staff member under the
--    same facility schedule lock and facility/date lock the booking already takes.
--    The member must be active, working the whole slot (date override, else the
--    weekly schedule; business hours are enforced by the public gate as before),
--    have no overlapping reservation including the facility buffer, and handle
--    every booked menu per menu_staff. Ties are broken by sort_order, then id.
--    No free member raises BOOKING_CONFLICT.
--  * The assignment is not a nomination. bookings.staff_auto_assigned records
--    that nobody was nominated, so the rebook link does not preselect (and
--    charge the nomination fee of) the assigned member, the shop sees
--    「指名なし（担当: X）」, and a customer date change re-runs the assignment
--    instead of pinning the reservation to the first member (20261022100100).
--  * The assigned member's own LINE WORKS channel is told about the new
--    reservation, as a nominated member's channel is.
--  * Reservations that need "any" working staff still occupy capacity: legacy
--    rows stored without a staff member, and assigned rows whose member no
--    longer works that time (holiday or schedule saved over them, deactivated).
--    When one overlaps, every path (named create, おまかせ create, change,
--    get_available_slots) refuses once the overlapping reservations of the
--    facility reach the number of staff working the slot.
--
-- No data rewrite. Production has no future reservations without staff.
-- Receipt and manual-booking wrappers keep their signatures and grants.
--
-- Order: apply this migration BEFORE deploying the application that selects
-- bookings.staff_auto_assigned (My Page, admin lists and the schedule board would
-- otherwise get PostgREST 400 for an unknown column). The current worker already
-- accepts the LINE WORKS job queued here. 20261022100100 comes after the deploy.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- Metadata-only on PostgreSQL 11+ (constant default): existing rows read false,
-- which is right for them (nominated, or legacy rows without staff).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS staff_auto_assigned boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.bookings.staff_auto_assigned IS
  'true: nobody was nominated (おまかせ / 指名なし); staff_id is the member the booking RPC assigned. Not a nomination: no nomination fee, no rebook preset, reassigned on a customer date change.';

-- Same working-window rule as the existing G2 capacity count and the named gate:
-- a date override replaces the weekly schedule; a holiday override closes the day.
CREATE OR REPLACE FUNCTION public.booking_staff_works_slot(p_staff_id uuid, p_date date, p_start time, p_end time)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM (SELECT 1) dummy
    LEFT JOIN public.schedule_overrides so ON so.staff_id = p_staff_id AND so.date = p_date
    LEFT JOIN public.staff_schedules ss ON ss.staff_id = p_staff_id AND ss.day_of_week = EXTRACT(DOW FROM p_date)::int
    WHERE NOT (so.is_holiday IS TRUE)
      AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) IS NOT NULL
      AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) <= p_start
      AND (CASE WHEN so.start_time IS NOT NULL THEN so.end_time ELSE ss.end_time END) >= p_end
  );
$$;
REVOKE ALL ON FUNCTION public.booking_staff_works_slot(uuid,date,time,time) FROM PUBLIC, anon, authenticated;

-- Internal helpers: only the SECURITY DEFINER booking functions (as owner) call them.
-- True for a reservation that needs "any" working staff member rather than its own:
-- stored without staff (legacy), or assigned automatically to a member who is no
-- longer active or no longer works that time. A nominated member's absence is the
-- shop's to resolve with the customer and does not take another member's time.
CREATE OR REPLACE FUNCTION public.booking_needs_any_staff(
  p_staff_id uuid, p_auto_assigned boolean, p_facility_id uuid, p_date date, p_start time, p_end time)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_staff_id IS NULL OR (p_auto_assigned IS TRUE AND NOT (
    EXISTS (SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = p_staff_id AND sp.facility_id = p_facility_id AND sp.is_active = true)
    AND public.booking_staff_works_slot(p_staff_id, p_date, p_start, p_end)));
$$;
REVOKE ALL ON FUNCTION public.booking_needs_any_staff(uuid,boolean,uuid,date,time,time) FROM PUBLIC, anon, authenticated;

-- The free member for a reservation without a nomination: active, working the
-- whole slot, no overlapping reservation including the buffer (the moved
-- reservation itself excluded), and able to handle every menu per menu_staff
-- (a menu with rows is handled only by the listed staff; without rows by all).
-- The preferred member (the current one on a change) wins while still free so a
-- change does not move the reservation between staff without need; otherwise
-- sort_order, then id. NULL when nobody is free.
CREATE OR REPLACE FUNCTION public.booking_pick_free_staff(
  p_facility_id uuid, p_date date, p_start time, p_end time, p_buffer_minutes int,
  p_menu_ids uuid[], p_exclude_booking_id uuid, p_prefer_staff_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT sp.id
  FROM public.staff_profiles sp
  WHERE sp.facility_id = p_facility_id
    AND sp.is_active = true
    AND public.booking_staff_works_slot(sp.id, p_date, p_start, p_end)
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.staff_id = sp.id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
        AND b.id IS DISTINCT FROM p_exclude_booking_id
        AND b.start_time < p_end + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval
        AND b.end_time + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval > p_start
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p_menu_ids, ARRAY[]::uuid[])) AS chosen(id)
      WHERE chosen.id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id)
        AND NOT EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id AND ms.staff_id = sp.id)
    )
  ORDER BY (sp.id IS NOT DISTINCT FROM p_prefer_staff_id) DESC, sp.sort_order NULLS LAST, sp.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.booking_pick_free_staff(uuid,date,time,time,integer,uuid[],uuid,uuid) FROM PUBLIC, anon, authenticated;

-- True when a reservation that needs any working staff (see above) overlaps the
-- slot and the overlapping reservations of the facility already fill the
-- working staff. p_exclude_booking_id leaves out the reservation being moved.
CREATE OR REPLACE FUNCTION public.booking_unassigned_capacity_full(
  p_facility_id uuid, p_date date, p_start time, p_end time, p_buffer_minutes int, p_exclude_booking_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.facility_id = p_facility_id AND b.booking_date = p_date
      AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND b.start_time < p_end + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval
      AND b.end_time + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval > p_start
      AND public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time)
  ) AND (
    SELECT count(*) FROM public.bookings b
    WHERE b.facility_id = p_facility_id AND b.booking_date = p_date
      AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND b.start_time < p_end + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval
      AND b.end_time + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval > p_start
  ) >= (
    SELECT count(*) FROM public.staff_profiles sp
    WHERE sp.facility_id = p_facility_id AND sp.is_active = true
      AND public.booking_staff_works_slot(sp.id, p_date, p_start, p_end)
  );
$$;
REVOKE ALL ON FUNCTION public.booking_unassigned_capacity_full(uuid,date,time,time,integer,uuid) FROM PUBLIC, anon, authenticated;

-- Authoritative body of create_booking_atomic (20261002012045 + the staff
-- schedule lock of 20261008080210), with every booked menu passed in so that
-- the おまかせ assignment can respect menu_staff for multi-menu reservations.
CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_user_id UUID,
  p_menu_id UUID,
  p_coupon_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_points_used INT,
  p_status TEXT,
  p_enforce_schedule BOOLEAN,
  p_menu_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
  v_max_uses INT;
  v_redemption_count INT;
  v_buffer_minutes INT;
  -- The staff member stored on the reservation: the named one, or the one assigned below.
  v_staff_id UUID := p_staff_id;
  v_menu_ids UUID[];
  -- スケジュールゲート専用変数（既存ロジックの変数と共有しない＝既存挙動へ波及させない）
  v_business_hours JSONB;
  v_gate_dow INT;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
  v_gate_is_holiday BOOLEAN;
  v_gate_work_start TIME;
  v_gate_work_end TIME;
BEGIN
  PERFORM public.lock_booking_account(p_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = p_facility_id;

  -- スケジュールゲート a.（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    -- Lock the readiness inputs through the public mutation; admin manual booking is unchanged.
    PERFORM id FROM public.facility_profiles WHERE id = p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE facility_id = p_facility_id AND is_published IS DISTINCT FROM false FOR SHARE;
    PERFORM id FROM public.facility_photos WHERE facility_id = p_facility_id FOR SHARE;
    PERFORM id FROM public.staff_profiles WHERE facility_id = p_facility_id AND is_active FOR SHARE;
    SELECT COALESCE(booking_buffer_minutes, 0), business_hours INTO v_buffer_minutes, v_business_hours
    FROM public.facility_profiles WHERE id = p_facility_id;
    PERFORM id FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id FOR SHARE;
    IF NOT public.facility_booking_ready(p_facility_id) THEN
      RAISE EXCEPTION 'BOOKING_NOT_READY: ネット予約は準備中です';
    END IF;
    IF p_staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id AND is_active
    ) THEN RAISE EXCEPTION 'STAFF_NOT_WORKING: 指定スタッフは現在受付していません'; END IF;
    IF p_menu_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false
    ) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE: 選択メニューは現在受付していません'; END IF;
    v_gate_dow := EXTRACT(DOW FROM p_booking_date)::int;

    -- a. business_hours ゲート（指名/おまかせ共通）。
    --    NULL / 非 object / 曜日キー不在はゲートしない（get_available_slots と同一解釈）。
    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
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
    END IF;
  END IF;

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。
    PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません';
    END IF;

    -- スケジュールゲート b.（G1 所属チェックの直後・既存予約重複チェックの前。
    --    公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots と同じ優先順:
    --    schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF p_enforce_schedule THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = p_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_gate_dow;
      END IF;

      -- 勤務窓が取れない（end_time NULL 含む・NULL 比較で素通りさせない fail-closed）、
      -- または窓が [p_start_time, p_end_time] を包含しない → 拒否。
      IF v_gate_work_start IS NULL
        OR v_gate_work_end IS NULL
        OR v_gate_work_start > p_start_time
        OR v_gate_work_end < p_end_time THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    -- A legacy reservation without a staff member still needs one of the working staff.
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    v_menu_ids := ARRAY(
      SELECT DISTINCT chosen.id
      FROM unnest(array_append(COALESCE(p_menu_ids, ARRAY[]::uuid[]), p_menu_id)) AS chosen(id)
      WHERE chosen.id IS NOT NULL
    );

    -- おまかせ: store a concrete free staff member so that later named reservations,
    -- changes and get_available_slots see the slot as taken by that member.
    -- staff_auto_assigned (below) keeps it from reading as a nomination.
    v_staff_id := public.booking_pick_free_staff(p_facility_id, p_booking_date, p_start_time, p_end_time,
      v_buffer_minutes, v_menu_ids, NULL, NULL);

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    SELECT max_uses INTO v_max_uses FROM coupons WHERE id = p_coupon_id FOR UPDATE;
    IF v_max_uses IS NOT NULL THEN
      SELECT COUNT(*) INTO v_redemption_count FROM coupon_redemptions WHERE coupon_id = p_coupon_id;
      IF v_redemption_count >= v_max_uses THEN
        RAISE EXCEPTION 'COUPON_LIMIT: このクーポンは利用上限に達しています';
      END IF;
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, staff_auto_assigned, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, v_staff_id, p_staff_id IS NULL, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status
  )
  RETURNING id INTO v_booking_id;

  IF p_coupon_id IS NOT NULL THEN
    BEGIN
      INSERT INTO coupon_redemptions (coupon_id, user_id, booking_id)
      VALUES (p_coupon_id, p_user_id, v_booking_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'COUPON_ALREADY_USED: このクーポンは既に利用済みです';
    END;
  END IF;

  RETURN v_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  TO service_role;

-- Existing signature, defaults and grants are kept for every current caller.
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_user_id UUID,
  p_menu_id UUID,
  p_coupon_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_points_used INT DEFAULT 0,
  p_status TEXT DEFAULT 'pending',
  p_enforce_schedule BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.create_booking_for_menus_atomic(p_facility_id, p_staff_id, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time, p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status, p_enforce_schedule, ARRAY[p_menu_id]);
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean)
  TO service_role;

-- Public wrapper (20261002012045 + schedule lock of 20261008080210): unchanged
-- except that the full menu selection reaches the staff assignment.
CREATE OR REPLACE FUNCTION public.create_online_booking_atomic(
  p_facility_id uuid, p_staff_id uuid, p_user_id uuid, p_menu_id uuid,
  p_coupon_id uuid, p_booking_date date, p_start_time time, p_end_time time,
  p_customer_name text, p_email text, p_phone text, p_note text,
  p_total_price int, p_points_used int, p_status text, p_menu_ids uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE new_id uuid; selected_count int;
BEGIN
  IF p_menu_ids IS NULL OR cardinality(p_menu_ids) < 1 OR cardinality(p_menu_ids) > 20
    OR p_menu_ids[1] IS DISTINCT FROM p_menu_id
    OR EXISTS (SELECT 1 FROM unnest(p_menu_ids) m(id) WHERE m.id IS NULL)
    OR (SELECT count(DISTINCT m.id) FROM unnest(p_menu_ids) m(id)) <> cardinality(p_menu_ids) THEN
    RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE';
  END IF;
  PERFORM public.lock_booking_account(p_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || p_booking_date::text),16))::bit(64)::bigint);
  PERFORM id FROM public.facility_profiles WHERE id=p_facility_id FOR SHARE;
  -- Lock actual selected rows, including currently hidden ones, before checking.
  PERFORM id FROM public.facility_menus WHERE id=ANY(p_menu_ids) ORDER BY id FOR SHARE;
  SELECT count(*) INTO selected_count FROM public.facility_menus
    WHERE id=ANY(p_menu_ids) AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false;
  IF selected_count <> cardinality(p_menu_ids) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE'; END IF;
  new_id := public.create_booking_for_menus_atomic(p_facility_id,p_staff_id,p_user_id,p_menu_id,
    p_coupon_id,p_booking_date,p_start_time,p_end_time,p_customer_name,p_email,p_phone,p_note,
    p_total_price,p_points_used,p_status,true,p_menu_ids);
  IF cardinality(p_menu_ids) > 1 THEN
    UPDATE public.bookings SET menu_ids=p_menu_ids WHERE id=new_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  END IF;
  RETURN new_id;
END;
$$;
-- Only the receipt gateway (as its owner) may call it; see 20261009005709.
REVOKE ALL ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM service_role;

-- Manual (phone) bookings without a staff member get the same assignment,
-- checked against every selected menu. Only the core call changes.
DO $$
DECLARE definition text; old text; replacement text;
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.create_manual_booking_atomic(uuid,uuid,jsonb)'::regprocedure);
  old := '  v_booking := public.create_booking_atomic(v_facility, v_staff, NULL, v_menus[1], NULL,' || chr(10)
    || '    v_date, v_start, v_end, p_input->>''customer_name'', p_input->>''email'', p_input->>''phone'',' || chr(10)
    || '    p_input->>''note'', v_price::int, 0, ''confirmed'', false);';
  replacement := '  v_booking := public.create_booking_for_menus_atomic(v_facility, v_staff, NULL, v_menus[1], NULL,' || chr(10)
    || '    v_date, v_start, v_end, p_input->>''customer_name'', p_input->>''email'', p_input->>''phone'',' || chr(10)
    || '    p_input->>''note'', v_price::int, 0, ''confirmed'', false, v_menus);';
  IF strpos(definition, old) = 0 OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'MANUAL_BOOKING_ASSIGNMENT_FORWARD_UPDATE_MISMATCH';
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_booking_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_booking_atomic(uuid, uuid, jsonb) TO service_role;

-- The notification snapshot names the staff member the customer chose. An
-- assigned おまかせ member is internal and must not make the client-built
-- snapshot (staff_name null) look changed (BOOKING_NOTIFICATION_SNAPSHOT_CHANGED).
--
-- The client plan only knows the members it can see before the assignment
-- (the nominated one and notify_all channels). For おまかせ the assigned
-- member's own channel is queued here, in the same transaction, unless a
-- notify_all channel already covers it. start_booking_create_notification
-- accepts it at send time because that member is the reservation's staff_id.
DO $$
DECLARE definition text; old_snapshot text; old_response text; assigned_works text;
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb)'::regprocedure);
  old_snapshot := 'LEFT JOIN public.staff_profiles s ON s.id=b.staff_id WHERE f.id=b.facility_id;';
  old_response := '  response:=jsonb_build_object(''success'',true,''state'',''accepted'',';
  IF strpos(definition, old_snapshot) = 0
    OR (length(definition) - length(replace(definition, old_snapshot, ''))) / length(old_snapshot) <> 1 THEN
    RAISE EXCEPTION 'BOOKING_RECEIPT_STAFF_SNAPSHOT_FORWARD_UPDATE_MISMATCH';
  END IF;
  IF strpos(definition, old_response) = 0
    OR (length(definition) - length(replace(definition, old_response, ''))) / length(old_response) <> 1 THEN
    RAISE EXCEPTION 'BOOKING_RECEIPT_ASSIGNED_WORKS_FORWARD_UPDATE_MISMATCH';
  END IF;
  assigned_works := '  IF p_staff_id IS NULL AND (context->>''works_enabled'')::boolean THEN' || chr(10)
    || '    INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)' || chr(10)
    || '      SELECT gen_random_uuid(),''booking_creation_lineworks'',s.line_works_channel_id,p_facility_id,' || chr(10)
    || '        jsonb_build_object(''customerName'',b.customer_name,''menuName'',snapshot->>''menu_name'',''bookingDate'',b.booking_date::text,' || chr(10)
    || '          ''startTime'',to_char(b.start_time,''HH24:MI''),''staffName'',s.name,''dispatch_version'',2,' || chr(10)
    || '          ''booking_snapshot'',snapshot-ARRAY[''email'',''facility_name'',''end_time'',''total_price'',''status''],' || chr(10)
    || '          ''booking_create_operation'',p_id::text,''booking_id'',booking_new_id::text,''booking_role'',''staff''),' || chr(10)
    || '        ''pending'',clock_timestamp()' || chr(10)
    || '      FROM public.staff_profiles s' || chr(10)
    || '      WHERE s.id=b.staff_id AND s.facility_id=p_facility_id AND nullif(s.line_works_channel_id,'''') IS NOT NULL' || chr(10)
    || '        AND NOT (s.line_works_channel_id=ANY(expected_works));' || chr(10)
    || '  END IF;' || chr(10);
  definition := replace(definition, old_snapshot, 'LEFT JOIN public.staff_profiles s ON s.id=p_staff_id WHERE f.id=b.facility_id;');
  EXECUTE replace(definition, old_response, assigned_works || old_response);
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) TO service_role;

-- At send time a notification frozen without a staff name (おまかせ) does not
-- show any staff, so the assigned member is not part of what must still match.
-- A notification frozen with a staff name is still superseded when it changes.
DO $$
DECLARE definition text; old text;
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.start_booking_create_notification(uuid,timestamptz)'::regprocedure);
  old := '''staff_name'',s.name,';
  IF strpos(definition, old) = 0 OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_STAFF_SNAPSHOT_FORWARD_UPDATE_MISMATCH';
  END IF;
  EXECUTE replace(definition, old,
    '''staff_name'',CASE WHEN q.payload->''booking_snapshot''->''staff_name''=''null''::jsonb THEN NULL ELSE s.name END,');
END;
$$;
REVOKE ALL ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) TO service_role;

-- get_available_slots (20261002012045): a member's slot is also closed when
-- reservations that need any working staff (legacy without staff, or assigned to
-- a member who no longer works them) already fill the working staff.
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week INT;
  v_work_start TIME;
  v_work_end TIME;
  v_is_holiday BOOLEAN;
  v_current_start TIME;
  v_current_end TIME;
  v_buffer_minutes INT;
  v_business_hours JSONB;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
  v_has_unassigned BOOLEAN;
  v_slot_free BOOLEAN;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN RETURN; END IF;
  IF NOT public.facility_booking_ready(p_facility_id) OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id AND is_active
  ) THEN RETURN; END IF;
  v_day_of_week := EXTRACT(DOW FROM p_date);

  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles
  WHERE id = p_facility_id;

  SELECT so.is_holiday, so.start_time, so.end_time
  INTO v_is_holiday, v_work_start, v_work_end
  FROM schedule_overrides so
  WHERE so.staff_id = p_staff_id AND so.date = p_date;

  IF FOUND AND v_is_holiday THEN
    RETURN;
  END IF;

  IF v_work_start IS NULL THEN
    SELECT ss.start_time, ss.end_time
    INTO v_work_start, v_work_end
    FROM staff_schedules ss
    WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_day_of_week;
  END IF;

  IF v_work_start IS NULL THEN
    RETURN;
  END IF;

  -- #2: 施設営業時間との交差。business_hours[曜日]=null は定休日→枠ゼロ。{open,close} は勤務窓をクランプ。
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

  -- Only days with a reservation that needs any working staff (legacy without staff,
  -- or assigned to a member who no longer works it) pay for the capacity count per slot.
  v_has_unassigned := EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.facility_id = p_facility_id AND b.booking_date = p_date
      AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND public.booking_needs_any_staff(b.staff_id, b.staff_auto_assigned, b.facility_id, b.booking_date, b.start_time, b.end_time)
  );

  v_current_start := v_work_start;
  -- TIME addition wraps at midnight. Compare remaining time before adding.
  WHILE v_current_start <= v_work_end
    AND v_work_end - v_current_start >= make_interval(mins => p_duration_minutes) LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    v_slot_free := NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
        AND (b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL)
        AND (b.end_time + (v_buffer_minutes || ' minutes')::INTERVAL > v_current_start)
    );
    IF v_slot_free AND v_has_unassigned THEN
      v_slot_free := NOT public.booking_unassigned_capacity_full(
        p_facility_id, p_date, v_current_start, v_current_end, v_buffer_minutes, NULL);
    END IF;

    IF v_slot_free THEN
      slot_start := v_current_start;
      slot_end := v_current_end;
      RETURN NEXT;
    END IF;

    EXIT WHEN v_work_end - v_current_start < interval '30 minutes';
    v_current_start := v_current_start + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;
-- Availability reads stay server-only (20261020150500).
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) TO service_role;
