-- 予約バッファタイム（v8.16）
-- 施術後の準備時間（分）を施設ごとに設定

ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER DEFAULT 0 CHECK (booking_buffer_minutes >= 0 AND booking_buffer_minutes <= 120);

-- get_available_slots をバッファタイム対応版に更新
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

  -- 施設のバッファタイム取得
  SELECT COALESCE(booking_buffer_minutes, 0)
  INTO v_buffer_minutes
  FROM facility_profiles
  WHERE id = p_facility_id;

  -- 例外日チェック
  SELECT so.is_holiday, so.start_time, so.end_time
  INTO v_is_holiday, v_work_start, v_work_end
  FROM schedule_overrides so
  WHERE so.staff_id = p_staff_id AND so.date = p_date;

  IF FOUND AND v_is_holiday THEN
    RETURN; -- 休日
  END IF;

  -- 例外日に時間指定がなければ通常スケジュール
  IF v_work_start IS NULL THEN
    SELECT ss.start_time, ss.end_time
    INTO v_work_start, v_work_end
    FROM staff_schedules ss
    WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_day_of_week;
  END IF;

  IF v_work_start IS NULL THEN
    RETURN; -- スケジュール未設定
  END IF;

  -- 30分刻みでスロット生成
  v_current_start := v_work_start;
  WHILE v_current_start + (p_duration_minutes || ' minutes')::INTERVAL <= v_work_end LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    -- 既存予約との競合チェック（バッファタイム込み）
    -- 既存予約の end_time + buffer が新スロットの start と重なる場合もNG
    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show')
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
