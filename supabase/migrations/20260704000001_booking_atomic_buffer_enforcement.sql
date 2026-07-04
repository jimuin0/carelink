-- 2026年7月4日: create_booking_atomic / change_booking_atomic の競合判定に booking_buffer_minutes を強制する（M-2）。
--
-- 背景（事実）:
--   get_available_slots（20260703000002）は booking_buffer_minutes を前後対称に適用し、
--   施術直後の準備時間を確保した空き枠のみを提示する。しかし権威側（予約の作成/変更を実際に
--   確定する create_booking_atomic / change_booking_atomic）の競合判定は素の重なりのみ
--   （start_time < p_end_time AND end_time > p_start_time）でバッファを一切見ていなかった。
--   UI が提示しない隣接枠（バッファ違反）でも、既存予約ゼロの状態で複数ユーザーが同時に
--   異なる隣接枠を取得すると、RPC 側は互いに重ならないため両方成立し、施術直後の準備時間が
--   保証されないバッファ違反予約が生まれる。
--
-- 修正（発症前の真の予防）:
--   get_available_slots と同一のバッファ式を4箇所（create指名/おまかせ・change指名/おまかせ）の
--   競合判定に適用する。バッファは「同一スタッフの前後予約の間隔」を保証するものなので、
--   施設全体で数える「おまかせ」の重なりカウントにも同様に適用する（施設全体の枠の重なりが
--   バッファを侵さないことを保証する対象は変わらない）。
--   容量判定（v_active_staff との比較）自体は変更しない（G2 は勤務実態の分母是正、本 migration は
--   バッファの強制のみを追加する別軸の修正）。
-- 冪等性: CREATE OR REPLACE。再適用安全。

-- 1. create_booking_atomic
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
  p_status TEXT DEFAULT 'pending'
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
BEGIN
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  SELECT COALESCE(booking_buffer_minutes, 0) INTO v_buffer_minutes
  FROM facility_profiles WHERE id = p_facility_id;

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。
    PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません';
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

-- 2. change_booking_atomic
CREATE OR REPLACE FUNCTION change_booking_atomic(
  p_booking_id UUID,
  p_user_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME
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
BEGIN
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
  SELECT COALESCE(booking_buffer_minutes, 0) INTO v_buffer_minutes
  FROM facility_profiles WHERE id = v_facility_id;

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
