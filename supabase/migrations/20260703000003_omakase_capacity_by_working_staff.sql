-- 2026年7月3日: おまかせ(指名なし)予約の容量判定を「実際にその時間に勤務するスタッフ数」に是正（G2）。
--
-- 背景（事実）:
--   create_booking_atomic / change_booking_atomic のおまかせ分岐は容量を
--   「施設の is_active=true スタッフ総数(v_active_staff)」で判定していた。しかし
--   get_available_slots は staff_schedules / schedule_overrides（勤務曜日・勤務時間・休日）を
--   見て「その時間に勤務するスタッフの空き枠」だけを提示する。両者の容量観が食い違うため、
--   在籍3名でもその時間帯に1名しか勤務しない枠に、直接API/同時リクエストで最大3件のおまかせ予約が
--   通り、担当不能な予約が生まれる（全員休みの日でも v_active_staff>0 なら受理し得た）。
--
-- 修正（発症前の真の予防）:
--   おまかせ容量の分母を「[p_start_time, p_end_time) を勤務窓が包含する is_active スタッフ数」に変更。
--   判定は get_available_slots の勤務窓ロジックを忠実にミラー:
--     - 当日 override が holiday → 勤務しない
--     - override.start が非NULL → 勤務窓 = (override.start, override.end)
--     - それ以外(override無 or override.start=NULL) → 週間 staff_schedules(曜日一致) = (ss.start, ss.end)
--     - 勤務窓が予約時間帯を包含(window.start <= p_start AND window.end >= p_end)する時のみ「勤務中」
--   これにより UI(get_available_slots 合算)が「空きあり」と示す枠は必ず勤務中スタッフ≥1 のため
--   正規予約は弾かれず、勤務実態を超えるオーバーブッキングだけを防ぐ。
--
-- 属性維持: create は 20260703000002 の G1 ガード＋SECURITY DEFINER/search_path を、
--   change は 20260626000005 の本体を忠実に再現し、おまかせ容量の分母のみ差し替える。
-- 冪等性: CREATE OR REPLACE。再適用安全。

-- 1. create_booking_atomic（G1 ガード維持 + G2 おまかせ容量是正）
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
BEGIN
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

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
      AND start_time < p_end_time
      AND end_time > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time
      AND end_time > p_start_time;

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

-- 2. change_booking_atomic（20260626000005 本体 + G2 おまかせ容量是正）
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

  IF v_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = v_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time
      AND end_time > p_start_time;

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
      AND start_time < p_end_time
      AND end_time > p_start_time;

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
