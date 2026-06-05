-- 占有判定 RPC の権威版を「最後に適用」させる再適用（本番監査 #13・fresh db push 退行防止）
--
-- 問題（事実）: 占有判定の正版は 20260604_cancel_fee_paid_slot_release.sql（booking_status_occupies() に
--   一元化）だが、ファイル名のアルファベット順では facility_status_gate.sql（create_booking_atomic を旧
--   NOT IN ('cancelled','no_show') で再定義）と concurrency_hardening.sql（create_admin_booking_atomic /
--   update_admin_booking_atomic を旧 NOT IN で再定義）が release より「後」に適用される。
--   本番は SQL Editor で release を最後に手動適用したため現状は正しいが、`supabase db push` で新環境を
--   ファイル名順に再構築すると gate / concurrency の旧定義が release を上書きし、cancel_fee_paid が枠を
--   占有する状態に退行する（再予約不可・カレンダー full・日次上限水増し）。
--
-- 対策: release と同一の権威定義（booking_status_occupies / create_booking_atomic / create_admin_booking_atomic /
--   update_admin_booking_atomic / get_available_slots）を、確実に最後にソートされる本ファイル(20260606)で再適用する。
--   冪等な CREATE OR REPLACE のため本番(適用済み)では no-op、fresh push では最終勝者となり退行を防ぐ。

-- ========================= 占有判定の単一真実源 =========================
CREATE OR REPLACE FUNCTION booking_status_occupies(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  -- 枠を占有する＝キャンセル系(cancelled / no_show / cancel_fee_paid)以外
  SELECT p_status IS DISTINCT FROM 'cancelled'
     AND p_status IS DISTINCT FROM 'no_show'
     AND p_status IS DISTINCT FROM 'cancel_fee_paid';
$$;

-- ========================= 公開ネット予約 確定層（facility_status_gate 最終版を踏襲） =========================
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
  v_lock_key BIGINT;
  v_day_lock_key BIGINT;
  v_cap INT;
  v_day_count INT;
BEGIN
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text) || p_booking_date::text || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF NOT EXISTS (SELECT 1 FROM facility_profiles WHERE id = p_facility_id AND status = 'published') THEN
    RAISE EXCEPTION 'FACILITY_NOT_BOOKABLE: この施設は現在ネット予約を受け付けていません';
  END IF;

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count FROM bookings
    WHERE staff_id = p_staff_id AND booking_date = p_booking_date
      AND booking_status_occupies(status) AND start_time < p_end_time AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count FROM bookings
    WHERE facility_id = p_facility_id AND booking_date = p_booking_date
      AND booking_status_occupies(status) AND start_time < p_end_time AND end_time > p_start_time;
  END IF;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  IF EXISTS (
    SELECT 1 FROM facility_booking_suspensions
    WHERE facility_id = p_facility_id AND suspend_date = p_booking_date
      AND start_time < p_end_time AND end_time > p_start_time
  ) THEN
    RAISE EXCEPTION 'SUSPENDED: この時間帯はネット予約の受付を停止しています';
  END IF;

  SELECT max_bookings INTO v_cap FROM facility_daily_capacity
  WHERE facility_id = p_facility_id AND capacity_date = p_booking_date;
  IF v_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_day_count FROM bookings
    WHERE facility_id = p_facility_id AND booking_date = p_booking_date AND booking_status_occupies(status);
    IF v_day_count >= v_cap THEN
      RAISE EXCEPTION 'CAPACITY_FULL: 本日のネット予約受付は上限に達しました';
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time, customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, p_staff_id, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time, p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_booking_atomic TO anon, authenticated;

-- ========================= 管理 店頭/電話 予約（concurrency_hardening 版＋占有判定一元化） =========================
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
  v_day_lock_key BIGINT;
BEGIN
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND booking_status_occupies(status)
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND booking_status_occupies(status)
      AND start_time < p_end_time
      AND end_time > p_start_time;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
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
  v_day_lock_key BIGINT;
BEGIN
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND booking_status_occupies(status)
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND booking_status_occupies(status)
      AND start_time < p_end_time
      AND end_time > p_start_time;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
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

  RETURN v_updated_id;
END;
$$;

-- ========================= 空きスロット生成（booking_buffer 版＋占有判定一元化） =========================
CREATE OR REPLACE FUNCTION get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
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

    -- 既存予約との競合チェック（バッファタイム込み・占有判定は一元化関数で）
    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND booking_status_occupies(b.status)
        AND (b.start_time < v_current_end)
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

-- ========================= 競合検索用 部分インデックスも除外集合を一致させる =========================
-- 部分インデックスの述語をクエリ述語(cancel_fee_paid も除外)に揃えてプランナが確実に利用できるようにする。
DROP INDEX IF EXISTS idx_bookings_staff_date_active;
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date_active
  ON bookings(staff_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid');
