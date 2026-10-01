-- Listing publication is not permission to accept online bookings.
-- No data rewrite, schema column, RLS relaxation, or automatic publication.
CREATE OR REPLACE FUNCTION public.confirmed_booking_hours(p_hours jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE day text; entry jsonb; open_days int := 0;
BEGIN
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'object' THEN RETURN false; END IF;
  FOREACH day IN ARRAY ARRAY['mon','tue','wed','thu','fri','sat','sun'] LOOP
    IF NOT p_hours ? day THEN RETURN false; END IF;
    entry := p_hours -> day;
    IF entry = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(entry) <> 'object'
      OR jsonb_typeof(entry->'open') IS DISTINCT FROM 'string'
      OR jsonb_typeof(entry->'close') IS DISTINCT FROM 'string'
      OR (entry->>'open') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (entry->>'close') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (entry->>'open') >= (entry->>'close') THEN RETURN false; END IF;
    open_days := open_days + 1;
  END LOOP;
  RETURN open_days > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.facility_booking_ready(p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.facility_profiles f WHERE f.id = p_facility_id
      AND f.status = 'published' AND f.name ~ '[^[:space:]　]'
      AND f.prefecture ~ '[^[:space:]　]' AND f.city ~ '[^[:space:]　]' AND f.address ~ '[^[:space:]　]'
      AND public.confirmed_booking_hours(f.business_hours)
      AND EXISTS (SELECT 1 FROM public.facility_menus m WHERE m.facility_id = f.id AND m.is_published IS DISTINCT FROM false)
      AND EXISTS (SELECT 1 FROM public.facility_photos p WHERE p.facility_id = f.id)
      AND EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.facility_id = f.id AND s.is_active)
  );
$$;

REVOKE ALL ON FUNCTION public.confirmed_booking_hours(jsonb), public.facility_booking_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmed_booking_hours(jsonb), public.facility_booking_ready(uuid) TO anon, authenticated, service_role;

-- Existing authoritative bodies are preserved; only preparation guards are added.
-- Auth deletion locks the account before its owned profiles. Take the same
-- order before profile/day locks, rather than waiting for the INSERT's FK.
CREATE FUNCTION public.lock_booking_account(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  PERFORM u.id FROM auth.users u WHERE u.id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_ACCOUNT_UNAVAILABLE'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_booking_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION create_booking_atomic(
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
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
  v_max_uses INT;
  v_redemption_count INT;
  v_dow INT;
  v_buffer_minutes INT;
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
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    -- G2: 分母を「その時間帯に勤務する is_active スタッフ数」に（get_available_slots をミラー）。
    v_dow := EXTRACT(DOW FROM p_booking_date)::int;
    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles sp
    WHERE sp.facility_id = p_facility_id
      AND sp.is_active = true
      AND EXISTS (
        -- 相関サブクエリ: ダミー1行に対し当該スタッフ(sp.id)の当日 override と週間 schedule を
        -- LEFT JOIN し、勤務窓が予約時間帯を包含するか判定する（外部 sp.id は ON 句で参照＝相関で正当）。
        SELECT 1
        FROM (SELECT 1) dummy
        LEFT JOIN schedule_overrides so ON so.staff_id = sp.id AND so.date = p_booking_date
        LEFT JOIN staff_schedules ss ON ss.staff_id = sp.id AND ss.day_of_week = v_dow
        WHERE NOT (so.is_holiday IS TRUE)
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) IS NOT NULL
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) <= p_start_time
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.end_time   ELSE ss.end_time   END) >= p_end_time
      );

    IF v_conflict_count >= v_active_staff THEN
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
    facility_id, staff_id, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, p_staff_id, p_user_id, p_menu_id, p_coupon_id,
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

CREATE OR REPLACE FUNCTION change_booking_atomic(
  p_booking_id UUID,
  p_user_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_enforce_schedule BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_id UUID;
  v_staff_id UUID;
  v_status TEXT;
  v_owner UUID;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
  v_dow INT;
  v_buffer_minutes INT;
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
  SELECT facility_id, staff_id, status, user_id
    INTO v_facility_id, v_staff_id, v_status, v_owner
  FROM bookings
  WHERE id = p_booking_id;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;
  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN';
  END IF;
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'BOOKING_NOT_CHANGEABLE';
  END IF;

  v_lock_key := ('x' || left(md5(v_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = v_facility_id;

  -- スケジュールゲート（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    -- Lock the readiness inputs through the public mutation; admin manual booking is unchanged.
    PERFORM id FROM public.facility_profiles WHERE id = v_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE facility_id = v_facility_id AND is_published IS DISTINCT FROM false FOR SHARE;
    PERFORM id FROM public.facility_photos WHERE facility_id = v_facility_id FOR SHARE;
    PERFORM id FROM public.staff_profiles WHERE facility_id = v_facility_id AND is_active FOR SHARE;
    SELECT COALESCE(booking_buffer_minutes, 0), business_hours INTO v_buffer_minutes, v_business_hours
    FROM public.facility_profiles WHERE id = v_facility_id;
    PERFORM id FROM public.staff_profiles WHERE id=v_staff_id AND facility_id=v_facility_id FOR SHARE;
    IF NOT public.facility_booking_ready(v_facility_id) THEN
      RAISE EXCEPTION 'BOOKING_NOT_READY: ネット予約は準備中です';
    END IF;
    IF v_staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff_profiles WHERE id=v_staff_id AND facility_id=v_facility_id AND is_active
    ) THEN RAISE EXCEPTION 'STAFF_NOT_WORKING: 担当スタッフは現在受付していません'; END IF;
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

    -- b. 指名スタッフ勤務窓ゲート（変更対象予約の担当スタッフに対して。get_available_slots と
    --    同じ優先順: schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF v_staff_id IS NOT NULL THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = v_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = v_staff_id AND ss.day_of_week = v_gate_dow;
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
  END IF;

  IF v_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = v_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = v_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    -- G2: おまかせ容量は勤務中スタッフ数（get_available_slots ミラー）。
    v_dow := EXTRACT(DOW FROM p_booking_date)::int;
    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles sp
    WHERE sp.facility_id = v_facility_id
      AND sp.is_active = true
      AND EXISTS (
        -- 相関サブクエリ: ダミー1行に対し当該スタッフ(sp.id)の当日 override と週間 schedule を
        -- LEFT JOIN し、勤務窓が予約時間帯を包含するか判定する（外部 sp.id は ON 句で参照＝相関で正当）。
        SELECT 1
        FROM (SELECT 1) dummy
        LEFT JOIN schedule_overrides so ON so.staff_id = sp.id AND so.date = p_booking_date
        LEFT JOIN staff_schedules ss ON ss.staff_id = sp.id AND ss.day_of_week = v_dow
        WHERE NOT (so.is_holiday IS TRUE)
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) IS NOT NULL
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) <= p_start_time
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.end_time   ELSE ss.end_time   END) >= p_end_time
      );

    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  UPDATE bookings
  SET booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = p_end_time,
      updated_at = NOW()
  WHERE id = p_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_available_slots(
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

  v_current_start := v_work_start;
  -- TIME addition wraps at midnight. Compare remaining time before adding.
  WHILE v_current_start <= v_work_end
    AND v_work_end - v_current_start >= make_interval(mins => p_duration_minutes) LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
        AND (b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL)
        AND (b.end_time + (v_buffer_minutes || ' minutes')::INTERVAL > v_current_start)
    ) THEN
      slot_start := v_current_start;
      slot_end := v_current_end;
      RETURN NEXT;
    END IF;

    EXIT WHEN v_work_end - v_current_start < interval '30 minutes';
    v_current_start := v_current_start + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;

-- Preserve the mutation boundary: p_enforce_schedule=false is never public.
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean),
  public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean),
  public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;

-- Public API wrapper: lock every selected menu and persist the full selection in
-- the same transaction as the reservation. No compensating second UPDATE.
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
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || p_booking_date::text),16))::bit(64)::bigint);
  PERFORM id FROM public.facility_profiles WHERE id=p_facility_id FOR SHARE;
  -- Lock actual selected rows, including currently hidden ones, before checking.
  PERFORM id FROM public.facility_menus WHERE id=ANY(p_menu_ids) ORDER BY id FOR SHARE;
  SELECT count(*) INTO selected_count FROM public.facility_menus
    WHERE id=ANY(p_menu_ids) AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false;
  IF selected_count <> cardinality(p_menu_ids) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE'; END IF;
  new_id := public.create_booking_atomic(p_facility_id,p_staff_id,p_user_id,p_menu_id,
    p_coupon_id,p_booking_date,p_start_time,p_end_time,p_customer_name,p_email,p_phone,p_note,
    p_total_price,p_points_used,p_status,true);
  IF cardinality(p_menu_ids) > 1 THEN
    UPDATE public.bookings SET menu_ids=p_menu_ids WHERE id=new_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  END IF;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  TO service_role;
