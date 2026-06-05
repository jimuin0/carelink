-- SALON BOARD 管理画面の予約 作成/変更を原子化（TOCTOU 二重予約レース修正）
--
-- 背景: admin の booking-create / booking-update は「重複SELECT → INSERT/UPDATE」の
-- check-then-write で、PostgREST の各呼び出しが別トランザクションのため、
-- 同一スタッフ・同一時間帯への同時2リクエストが両方とも count=0 を見て二重予約し得た。
-- 公開予約 create_booking_atomic と同様に pg_advisory_xact_lock で同一スロットを直列化する。
-- （EXCLUDE 制約は btree_gist 依存で Supabase で不確実なため advisory lock を採用）

-- 店頭/電話予約の原子的作成（source 付き・status は confirmed 固定）
CREATE OR REPLACE FUNCTION create_admin_booking_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_menu_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_source TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
BEGIN
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- advisory lock で同一スロットは直列化済みのため FOR UPDATE は不要。
  -- （COUNT(*) は集約のため FOR UPDATE 自体が PostgreSQL で不正）
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, menu_id, booking_date, start_time, end_time,
    customer_name, email, phone, note, total_price, status, source
  ) VALUES (
    p_facility_id, p_staff_id, p_menu_id, p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note, p_total_price, 'confirmed', p_source
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

-- 予約内容の原子的変更（自分自身を除外して競合チェック）。
-- 呼び出し側は変更後の最終値（未変更項目は既存値）を渡す。
CREATE OR REPLACE FUNCTION update_admin_booking_atomic(
  p_booking_id UUID,
  p_facility_id UUID,
  p_staff_id UUID,
  p_menu_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
BEGIN
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- advisory lock で同一スロットは直列化済みのため FOR UPDATE は不要。
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  UPDATE bookings SET
    staff_id = p_staff_id,
    menu_id = p_menu_id,
    booking_date = p_booking_date,
    start_time = p_start_time,
    end_time = p_end_time,
    customer_name = p_customer_name,
    email = p_email,
    phone = p_phone,
    note = p_note,
    total_price = p_total_price,
    updated_at = now()
  WHERE id = p_booking_id AND facility_id = p_facility_id
  RETURNING id INTO v_updated_id;

  RETURN v_updated_id; -- NULL なら対象なし（呼び出し側で 404）
END;
$$;
