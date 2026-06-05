-- ネット予約 確定層に施設 status ゲートを追加（round3 監査 #03）
--
-- 公開可否（facility_profiles.status='published'）の不変条件が表示層(anon RLS)にしか無く、
-- SECURITY DEFINER の create_booking_atomic（RLS迂回・唯一の挿入経路）に複製されていなかった。
-- draft/suspended/未存在の施設でも facility_id 既知なら /api/booking 直叩きで予約が成立していた。
-- 依存: 20260603_booking_gates.sql（本関数の直前版）が適用済みであること。本ファイルは status ゲートのみ追加した最終版。
-- 停止/上限ゲート(20260603)も保持。管理 手動投入 create_admin_booking_atomic は対象外（店頭/電話は停止中でも登録可）。
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
  -- 施設×日 → スロット の順で advisory lock（デッドロック回避の固定順）
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text) || p_booking_date::text || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- #03: 施設が公開中(published)でなければネット予約不可（draft/suspended/未存在を一律拒否）。
  -- SECURITY DEFINER で RLS を迂回するため、公開可否を確定層で自前判定するのが要。
  IF NOT EXISTS (SELECT 1 FROM facility_profiles WHERE id = p_facility_id AND status = 'published') THEN
    RAISE EXCEPTION 'FACILITY_NOT_BOOKABLE: この施設は現在ネット予約を受け付けていません';
  END IF;

  -- 競合チェック
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count FROM bookings
    WHERE staff_id = p_staff_id AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show') AND start_time < p_end_time AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count FROM bookings
    WHERE facility_id = p_facility_id AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show') AND start_time < p_end_time AND end_time > p_start_time;
  END IF;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  -- 時間帯停止（#03/#09/#10）
  IF EXISTS (
    SELECT 1 FROM facility_booking_suspensions
    WHERE facility_id = p_facility_id AND suspend_date = p_booking_date
      AND start_time < p_end_time AND end_time > p_start_time
  ) THEN
    RAISE EXCEPTION 'SUSPENDED: この時間帯はネット予約の受付を停止しています';
  END IF;

  -- 日別受付上限（#05/#46）
  SELECT max_bookings INTO v_cap FROM facility_daily_capacity
  WHERE facility_id = p_facility_id AND capacity_date = p_booking_date;
  IF v_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_day_count FROM bookings
    WHERE facility_id = p_facility_id AND booking_date = p_booking_date AND status NOT IN ('cancelled', 'no_show');
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
