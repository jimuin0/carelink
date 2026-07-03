-- 2026年7月3日: 監査確定バグ 2 件の発症前根治（RPC 権威側で fail-closed 化）。
--
-- G1（マルチテナント整合性・create_booking_atomic）:
--   指名あり予約の競合カウントは staff_id 単体で行い、その staff_id が p_facility_id に
--   所属するかを一切検証していなかった。API 側（booking/route.ts）の staff 参照は
--   nomination_fee 取得のみで facility_id 不一致でも reject せず素通りする。結果、直接 API を
--   叩けば「施設 A の予約に施設 B の staff を割り当て、B のカレンダーを無断占有」できた。
--   → 指名スタッフが当該施設に属することを RPC で必須化し、属さなければ STAFF_NOT_IN_FACILITY を
--     RAISE する（fail-closed）。UI は当該施設の staff しか出さないため正規利用は不変。
--
-- G3（バッファ非対称・get_available_slots）:
--   booking_buffer_minutes は「既存予約の end 側」にしか適用されておらず、候補スロットの
--   直後に始まる既存予約に対するバッファ（前側）が無かった。例: buffer=15分・既存 11:00-12:00 の
--   とき候補 10:00-11:00 が「バッファ 0」で予約可能になり、施術直後の準備時間が確保されない。
--   → 競合式を対称化し、候補終了の buffer 分後までに始まる既存予約も競合とみなす。
--
-- 属性の維持（退行防止）:
--   get_available_slots は 20260703000001 で SECURITY DEFINER + search_path=public 化済み。
--   CREATE OR REPLACE は未指定属性を既定（SECURITY INVOKER）へ戻すため、両属性を明示再指定して
--   AV-1（RLS 越しでも全予約を見て競合判定）を維持する。
--   create_booking_atomic は 20260626000005 の最新本体（クーポン上限 + cancel_fee_paid 除外）を
--   忠実に再現し、G1 ガードのみ追加（他の挙動差分なし）。
--
-- 冪等性: すべて CREATE OR REPLACE。再適用安全。

-- 1. create_booking_atomic（20260626000005 + G1: staff↔facility ガード）
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
BEGIN
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。属さなければ他施設の
    -- カレンダーを無断占有するマルチテナント違反になるため予約自体を弾く。
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

    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles
    WHERE facility_id = p_facility_id
      AND is_active = true;

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

-- 2. get_available_slots（20260626000005 バッファ版 + G3: バッファ対称化）
--    ※ 20260703000001 で付与された SECURITY DEFINER / search_path=public を明示再指定して維持する。
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
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_date);

  SELECT COALESCE(booking_buffer_minutes, 0)
  INTO v_buffer_minutes
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

  v_current_start := v_work_start;
  WHILE v_current_start + (p_duration_minutes || ' minutes')::INTERVAL <= v_work_end LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    -- G3: バッファを前後対称に適用する。既存予約の end 側だけでなく start 側にも buffer を効かせ、
    -- 候補スロット終了の buffer 分後までに始まる既存予約も競合とみなす（施術直後の準備時間を確保）。
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

    v_current_start := v_current_start + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;
