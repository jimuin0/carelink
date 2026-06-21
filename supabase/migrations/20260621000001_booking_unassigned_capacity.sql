-- 2026-06-21: 指名なし(おまかせ)予約の容量判定を「アクティブ施術者数」基準に修正（冪等再適用）。
--
-- 背景（事実・8体監査 A1#1/A6-2 で確定）:
--   旧 create_booking_atomic の staff_id IS NULL（指名なし）分岐は、施設内に同時間帯の
--   予約が 1 件でもあれば BOOKING_CONFLICT を投げていた（施設を席数1として扱う）。
--   一方 get_available_slots はスタッフ単位で空き枠を返すため、複数スタッフ在籍店では
--   「枠は空きと表示されるのに指名なし予約が拒否される」＝予約取りこぼしが発症していた。
--
-- 修正方針（神原確定: HPB 標準 = アクティブ施術者数まで受付）:
--   指名なしは「同時間帯に重なる予約数 < アクティブ施術者数」の間だけ受け付ける
--   （席数 = staff_profiles.is_active = true の人数）。これによりオーバーブッキングは起きず
--   （重なり数が席数に達したら競合）、かつ空いている施術者がいれば取りこぼさない。
--
-- race-safe 化（重要）:
--   旧実装は指名あり=staff+日付キー / 指名なし=施設+日付キーで advisory lock を取っており、
--   両者が別キー＝相互に直列化されなかった。指名なしの容量カウント中に別の指名あり予約が
--   commit されるとカウントを取りこぼし、稀に席数超過が起こり得た。
--   本修正で lock キーを「施設+日付」に統一し、当該施設・当該日の全予約書き込みを直列化する
--   （予約はサロン規模では低頻度・ロック保持はチェック+INSERT のマイクロ秒のみで実害なし）。
--   指名あり予約のスタッフ競合判定は従来どおり（WHERE staff_id=...）で正しく、
--   ロック範囲が広がるだけ＝正しさは不変。
--
-- 冪等性: CREATE OR REPLACE のため何度適用しても安全。

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
BEGIN
  -- ロックキーは「施設 + 予約日」。指名あり/なしを問わず当該施設・当該日の予約書き込みを
  -- 直列化し、指名なしの容量カウントが別トランザクションの指名あり INSERT を取りこぼさないようにする。
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    -- 指名あり: 当該スタッフの同時間帯重複は不可。
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
  ELSE
    -- 指名なし(おまかせ): 同時間帯に重なる予約数がアクティブ施術者数に達していたら満席=競合。
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;

    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles
    WHERE facility_id = p_facility_id
      AND is_active = true;

    -- 席数（アクティブ施術者数）に達している場合のみ競合。0 人なら受付不可（提供者なし）。
    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
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
