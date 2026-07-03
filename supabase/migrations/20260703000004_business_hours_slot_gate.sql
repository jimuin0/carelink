-- 2026年7月3日: 施設の営業時間・定休日を予約枠に反映（SSOT化・#2）。
--
-- 背景（事実）:
--   get_available_slots は staff_schedules / schedule_overrides のみで枠を出し、
--   facility_profiles.business_hours（設定画面の営業時間・定休日）を一切参照していなかった。
--   スタッフ作成時に全7日 09:00-19:00 の staff_schedules を seed するため、施設設定で
--   「月曜定休・10:00-20:00」としても、実際の予約枠は月曜9:00にも出る＝定休日・営業時間外に
--   予約が入る。公開初日に最も信頼を損なう事故。
--
-- 修正（発症前の真の予防・恒久SSOT）:
--   get_available_slots の勤務窓に施設営業時間を交差させる。
--     - business_hours[曜日] が JSON null → 定休日 → 枠ゼロ
--     - business_hours[曜日] が {open,close} → 勤務窓を [max(staff_open,open), min(staff_close,close)] にクランプ
--     - 曜日キーが無い/ business_hours 未設定 → ゲートせず（従来挙動を維持・既存施設を壊さない）
--   business_hours は JSONB、キーは mon..sun（EXTRACT(DOW): 0=sun..6=sat をマップ）。
--
-- 属性維持: 20260703000002 の本体（G3 バッファ対称・cancel_fee_paid 除外・SECURITY DEFINER・
--   search_path=public）を忠実に再現し、営業時間の交差のみ追加。冪等（CREATE OR REPLACE）。

CREATE OR REPLACE FUNCTION get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_of_week INT;
  v_work_start TIME;
  v_work_end TIME;
  v_is_holiday BOOLEAN;
  v_current_start TIME;
  v_current_end TIME;
  v_buffer_minutes INT;
  v_business_hours JSONB;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_date);

  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
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

  -- #2: 施設営業時間との交差。business_hours[曜日]=null は定休日→枠ゼロ。{open,close} は勤務窓をクランプ。
  -- キー不在・business_hours 未設定はゲートせず従来挙動（既存施設を壊さない）。
  IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
    v_day_key := CASE v_day_of_week
      WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
      WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
    v_day_val := v_business_hours -> v_day_key;
    IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
      IF jsonb_typeof(v_day_val) = 'null' THEN
        RETURN;                                   -- 定休日
      END IF;
      v_fac_open := (v_day_val ->> 'open')::time;
      v_fac_close := (v_day_val ->> 'close')::time;
      IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
        IF v_fac_open > v_work_start THEN v_work_start := v_fac_open; END IF;
        IF v_fac_close < v_work_end THEN v_work_end := v_fac_close; END IF;
      END IF;
    END IF;
  END IF;

  v_current_start := v_work_start;
  WHILE v_current_start + (p_duration_minutes || ' minutes')::INTERVAL <= v_work_end LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
        AND (b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL)
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
