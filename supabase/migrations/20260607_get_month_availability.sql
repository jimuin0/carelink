-- 月カレンダーの空き状況を「1往復」で取得する集約RPC（#G・availability の最悪310往復=日数×スタッフ を解消）。
--
-- 重要: 空き判定ロジックは既存 get_available_slots に内部委譲する（FROM get_available_slots(...)）。
-- これにより /api/slots と月カレンダーの空き判定が単一ソースのまま保たれ、ロジック分裂（divergence）が起きない。
-- 日別スロット数を返す。早期終了（1日あたり合計3スロット見つかった時点でスタッフ走査を打ち切り）まで
-- アプリ実装(totalSlots>=3 で break)と同義にして、返却値の意味（>=3/>=1/0 の閾値）を完全一致させる。
--
-- アプリ側はこのRPCが未適用/失敗でも従来の per-date ループに自動フォールバックするため、本マイグレーション
-- 適用前でも機能は無退行（適用後に往復数が 310→1 に縮む性能改善のみ）。冪等（CREATE OR REPLACE）。
CREATE OR REPLACE FUNCTION get_month_availability(
  p_facility_id UUID,
  p_staff_ids UUID[],
  p_dates DATE[],
  p_duration_minutes INT
)
RETURNS TABLE(d DATE, slots INT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_date DATE;
  v_staff UUID;
  v_total INT;
  v_cnt INT;
BEGIN
  IF p_dates IS NULL OR p_staff_ids IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_date IN ARRAY p_dates LOOP
    v_total := 0;
    FOREACH v_staff IN ARRAY p_staff_ids LOOP
      SELECT count(*) INTO v_cnt
      FROM get_available_slots(p_facility_id, v_staff, v_date, p_duration_minutes);
      v_total := v_total + v_cnt;
      EXIT WHEN v_total >= 3;  -- 早期終了（アプリの totalSlots>=3 break と同義）
    END LOOP;
    d := v_date;
    slots := v_total;
    RETURN NEXT;
  END LOOP;
END;
$$;
