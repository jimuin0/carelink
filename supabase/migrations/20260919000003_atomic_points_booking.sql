-- 予約時ポイント控除のTOCTOUをDBロック下で解消する。
-- 本番適用はSupabase SQL Editorで承認済みの固定計画に従って実施すること。
-- APIはこの関数が未適用の場合にfail-closed（予約をキャンセルして500）する。
CREATE OR REPLACE FUNCTION public.deduct_points_atomic(
  p_user_id UUID,
  p_points INT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INT;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS_REQUEST';
  END IF;

  -- 同一ユーザーの台帳行をロックして、残高確認と控除INSERTを同一トランザクションで行う。
  PERFORM 1 FROM public.user_points WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.user_points
    WHERE user_id = p_user_id;
  IF v_balance < p_points THEN
    RAISE EXCEPTION 'INSUFFICIENT_POINTS';
  END IF;

  INSERT INTO public.user_points(user_id, points, reason)
  VALUES (p_user_id, -p_points, p_reason)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('deduction_id', v_id, 'balance', v_balance - p_points);
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_points_atomic(UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_points_atomic(UUID, INT, TEXT) TO service_role;
