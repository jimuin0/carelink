-- Race condition fix: add advisory lock to create_booking_atomic
--
-- The FOR UPDATE clause only locks existing rows. When no conflicting booking exists yet,
-- two concurrent transactions both see count=0 and both INSERT successfully (phantom insert).
-- pg_advisory_xact_lock serializes concurrent attempts for the same slot without a
-- EXCLUDE constraint (which requires btree_gist extension not always available on Supabase).
--
-- Lock key: first 64 bits of MD5(staff_id_or_facility_id || booking_date || start_time)
-- The lock is automatically released when the transaction commits or rolls back.

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
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
BEGIN
  -- Acquire a transaction-scoped advisory lock keyed on (staff_or_facility, date, start_time).
  -- This serializes concurrent requests for the same slot, closing the phantom-insert window
  -- that FOR UPDATE alone cannot prevent when there are no existing conflicting rows.
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Conflict check (FOR UPDATE still useful to lock any existing rows)
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

  RETURN v_booking_id;
END;
$$;
