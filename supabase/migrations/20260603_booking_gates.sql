-- 予約確定層(RPC)の恒久ゲート整備（8観点監査の根本対策 A/B/E）
--
-- 依存: 本マイグレーションより先に 20260602_booking_suspensions.sql / 20260602_daily_capacity.sql を適用すること
-- （create_booking_atomic がこれらのテーブルを参照するため）。
--
-- A: ネット予約の「時間帯停止」「日別受付上限」を表示層(slots)だけでなく確定層(RPC)で
--    同一トランザクション・advisory lock 下に強制する（TOCTOU の原理的解消）。
-- B: 公開 create_booking_atomic の COUNT(*) に付いていた FOR UPDATE を削除
--    （集約クエリ + FOR UPDATE は PostgreSQL で構文エラー。直列化は advisory lock が担保）。
-- E: admin RPC の指名なし(staff_id NULL)時に競合チェックがスキップされる ELSE 節欠落を修正。
--
-- 停止/上限は「ネット予約」専用の受付制御のため、店頭/電話=手動投入の admin RPC には適用しない
-- （管理者は停止中でも手動登録可。ただし手動分も日別予約数に数えられネット受付の上限消費に寄与する）。

-- ========================= 公開ネット予約（A + B） =========================
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
  -- 施設×日の粗いロックを先に取得（日別受付上限の直列化）。次にスロット単位の細かいロック。
  -- 取得順を常に「日 → スロット」に固定しデッドロックを回避する。
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);

  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 競合チェック（advisory lock で直列化済みのため FOR UPDATE は不要・かつ集約には付与不可）
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  -- A-1: 時間帯停止（#03/#09/#10）。停止範囲と重なるネット予約を確定層で拒否。
  IF EXISTS (
    SELECT 1 FROM facility_booking_suspensions
    WHERE facility_id = p_facility_id
      AND suspend_date = p_booking_date
      AND start_time < p_end_time
      AND end_time > p_start_time
  ) THEN
    RAISE EXCEPTION 'SUSPENDED: この時間帯はネット予約の受付を停止しています';
  END IF;

  -- A-2: 日別受付上限（#05/#46）。当日のアクティブ予約数が上限に達していれば拒否（手動分も数える）。
  SELECT max_bookings INTO v_cap
  FROM facility_daily_capacity
  WHERE facility_id = p_facility_id AND capacity_date = p_booking_date;
  IF v_cap IS NOT NULL THEN
    SELECT COUNT(*) INTO v_day_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show');
    IF v_day_count >= v_cap THEN
      RAISE EXCEPTION 'CAPACITY_FULL: 本日のネット予約受付は上限に達しました';
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

  RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_booking_atomic TO anon, authenticated;

-- ========================= 管理 店頭/電話 予約（E：ELSE 節追加） =========================
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

  -- 指名あり/なし双方で競合チェック（公開版と対称）。advisory lock で直列化済みのため FOR UPDATE 不要。
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
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

-- ========================= 管理 予約変更（E：ELSE 節追加・自己除外） =========================
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

  -- 指名あり/なし双方で競合チェック（自分自身は除外）。
  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND status NOT IN ('cancelled', 'no_show')
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
