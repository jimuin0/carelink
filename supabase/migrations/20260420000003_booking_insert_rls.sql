-- Security fix: restrict direct INSERT to bookings table.
--
-- The existing "bookings_insert" policy (FOR INSERT WITH CHECK(true)) allows
-- any anon or authenticated Supabase client to INSERT arbitrary booking rows,
-- bypassing the API's validation (availability check, price calculation,
-- coupon validation, rate limiting, CSRF, advisory lock, etc.).
--
-- An attacker with the anon key could:
--   - Flood the bookings table with fake bookings, blocking slots
--   - Insert bookings with forged prices, staff IDs, or statuses
--
-- Fix: add SECURITY DEFINER to create_booking_atomic so the INSERT runs under
-- the function owner's rights (bypassing RLS), then drop the client INSERT policy.
-- All legitimate booking creation goes through this RPC via the API.
--
-- 2026-06-02 修正（root fix）: 当初版は競合チェックの `SELECT COUNT(*) ... FOR UPDATE`
-- を持っていたが、PostgreSQL は集約関数(COUNT)と FOR UPDATE の併用を 0A000
-- (FOR UPDATE is not allowed with aggregate functions) で**常に**拒否する。
-- これは関数を呼ぶたびに必ず発火するプラン時エラーで、本来予約 API 全滅となる致命バグ。
-- 本番は out-of-band 修正済みだったが repo に書き戻されておらず、新規 replay で再発する
-- 状態だった（20260602 ライブ実測で確定: 本番は 23503/FK で正常通過＝FOR UPDATE 無し）。
-- 併せて advisory lock key から start_time を除外する（理由は関数本体コメント参照）。
-- 同一内容を 20260602_booking_atomic_0a000_fix.sql でも冪等再適用する。

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
  -- start_time を含めると「開始時刻は違うが時間帯が重なる」予約同士が別キーになり、
  -- 直列化されず幻の二重予約レースが起きるため。日付単位で直列化するのが正。
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
    -- FOR UPDATE は付けない: 上の pg_advisory_xact_lock で既に直列化済み。
    -- かつ COUNT(集約) + FOR UPDATE は PostgreSQL が 0A000 で常に拒否するため致命的。
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
    -- FOR UPDATE は付けない: 上の pg_advisory_xact_lock で既に直列化済み。
    -- かつ COUNT(集約) + FOR UPDATE は PostgreSQL が 0A000 で常に拒否するため致命的。
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

-- 注: 旧版はこの後に DROP POLICY / GRANT を同一ファイルへ続けていたが、
-- 「引数付き CREATE FUNCTION の直後に別文が続く」と Supabase CLI 2.75.0 系の
-- 文分割器が 42601 を起こす（2.104.0 で修正済）。CLI バージョン非依存にするため
-- 後続文を 20260420000015_booking_insert_rls_grants.sql へ分離した。
-- 本ファイルは create_booking_atomic の定義（末尾＝最終文）のみを保持する。
