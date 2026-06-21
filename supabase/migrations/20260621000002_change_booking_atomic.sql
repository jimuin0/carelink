-- 2026-06-21: 予約変更(日時)を同一トランザクションで原子的に行う change_booking_atomic を新設。
--
-- 背景（事実・8体監査 A1#2/A4#2 で確定）:
--   src/app/api/booking/[id]/change/route.ts は「競合チェック(SELECT) → UPDATE」を別文で行い
--   advisory lock を通らないため TOCTOU でダブルブッキングが成立し得た。さらに競合チェックが
--   `if (booking.staff_id)` の中だけにあり、指名なし(staff_id NULL)の変更は競合チェックを一切
--   せず無条件 UPDATE していた（他予約の上へ移動可能）。create_booking_atomic が advisory lock で
--   塞いだ phantom 窓が変更経路で開いていた。
--
-- 修正（真の予防）:
--   create_booking_atomic と同じ「施設+日付」advisory lock の下で、所有権・状態・競合（指名あり=
--   スタッフ重複 / 指名なし=アクティブ施術者数までの容量）を検査してから UPDATE まで一括実行する。
--   これにより TOCTOU を解消し、指名なしの容量モデルも作成経路と一致させる。
--
-- エラーは RAISE EXCEPTION で呼び出し側へ通知:
--   BOOKING_NOT_FOUND / BOOKING_FORBIDDEN / BOOKING_NOT_CHANGEABLE / BOOKING_CONFLICT
--
-- 冪等性: CREATE OR REPLACE。GRANT は CLI 文分割器の 42601 回避のため別ファイルへ分離
--   （関数定義を本ファイルの最終文に保つ）。

CREATE OR REPLACE FUNCTION change_booking_atomic(
  p_booking_id UUID,
  p_user_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_id UUID;
  v_staff_id UUID;
  v_status TEXT;
  v_owner UUID;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
BEGIN
  SELECT facility_id, staff_id, status, user_id
    INTO v_facility_id, v_staff_id, v_status, v_owner
  FROM bookings
  WHERE id = p_booking_id;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;
  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN';
  END IF;
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'BOOKING_NOT_CHANGEABLE';
  END IF;

  -- create_booking_atomic と同一の「施設+日付」ロックで全予約書き込みを直列化。
  v_lock_key := ('x' || left(md5(v_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF v_staff_id IS NOT NULL THEN
    -- 指名あり: 当該スタッフの同時間帯重複は不可（自分自身は除外）。
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = v_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND id <> p_booking_id
      AND start_time < p_end_time
      AND end_time > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    -- 指名なし: 重なる予約数（自分以外）がアクティブ施術者数に達していたら満席=競合。
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = v_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND id <> p_booking_id
      AND start_time < p_end_time
      AND end_time > p_start_time;

    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles
    WHERE facility_id = v_facility_id
      AND is_active = true;

    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  -- 状態は同一ロック下で再確認済み（pending/confirmed 以外は上で除外）。日時のみ更新。
  UPDATE bookings
  SET booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = p_end_time,
      updated_at = NOW()
  WHERE id = p_booking_id;
END;
$$;
