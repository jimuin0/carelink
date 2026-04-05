-- 予約競合防止（v8.5）
-- アプリケーションレベルのチェックに加え、DB-levelでも競合を防止

-- 予約作成をアトミックに行うRPC（競合チェック+INSERT を1トランザクション内で実行）
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
  p_points_used INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
BEGIN
  -- 排他ロック付き競合チェック
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time
    FOR UPDATE;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time
    FOR UPDATE;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  -- INSERT
  INSERT INTO bookings (
    facility_id, staff_id, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, p_staff_id, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, 'pending'
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;
