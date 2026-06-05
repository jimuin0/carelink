-- 2026-06-02: create_booking_atomic の 0A000 landmine を恒久修正（冪等再適用）。
--
-- 背景（事実）:
--   20260420_booking_insert_rls.sql で定義された create_booking_atomic は
--   競合チェックに `SELECT COUNT(*) ... FOR UPDATE` を持っていた。
--   PostgreSQL は集約関数(COUNT)と FOR UPDATE の併用を 0A000
--   (FOR UPDATE is not allowed with aggregate functions) で**プラン時に常に**拒否する。
--   これは関数を呼ぶたび必ず発火する致命バグで、本来は予約 API 全滅となる。
--
--   本番 DB は out-of-band（migration 外）で既に修正されており（20260602 ライブ実測:
--   zero-UUID プローブが 23503/FK で正常通過＝FOR UPDATE 無しを確定）、現状は動作している。
--   しかし repo 側の migration には誤った定義が残っており、新規環境への replay で再発する
--   "静かなドリフト" 状態だった。本 migration は repo と本番を一致させる恒久修正。
--
-- 修正内容（root fix・発症前予防）:
--   (1) 競合チェックから FOR UPDATE を除去（pg_advisory_xact_lock で既に直列化済み）。
--   (2) advisory lock key から start_time を除外。start_time を含めると
--       「開始時刻は違うが時間帯が重なる」予約が別キーになり直列化されず、
--       幻の二重予約レースが起きるため。日付単位で直列化するのが正。
--
-- 冪等性: CREATE OR REPLACE のため何度適用しても安全。本番は既に正しい定義のため
--   実質 no-op（同一定義の上書き）。20260420_booking_insert_rls.sql とも同一内容。

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
BEGIN
  -- ロックキーは facility/staff + 予約日のみ（start_time は含めない）。
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
  ), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
    -- FOR UPDATE は付けない（advisory lock で直列化済み・集約+FOR UPDATE は 0A000）。
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
    -- FOR UPDATE は付けない（advisory lock で直列化済み・集約+FOR UPDATE は 0A000）。
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

-- 注: 後続の GRANT は 20260602000007_booking_atomic_0a000_grant.sql へ分離した。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」と CLI 2.75.0 系の文分割器が 42601 を
-- 起こす（2.104.0 で修正済）ため、CLI バージョン非依存にする目的。本ファイルは関数定義
-- （末尾＝最終文）のみを保持する。
