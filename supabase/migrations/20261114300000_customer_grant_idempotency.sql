-- 回数券・月額プランの付与を「操作 ID」で冪等にする（点検 B9-8・2026年11月14日）。
--
-- 【それまでの状態】grant_user_subscription_atomic / grant_user_package_atomic（20261022230000）は
-- 呼ぶたびに 1 行 INSERT していた。応答が届かずに API が再送されると（通信断・二重クリック・
-- 再試行）、同じお客様へ同じ回数券・プランが 2 回付与された。
--
-- 【この migration で入れるもの】
--   1. user_subscriptions / user_packages に grant_operation_id uuid（NULL 可・UNIQUE）を足す。
--      既存行は NULL のまま（UNIQUE は NULL 同士を区別するので既存データに影響しない）。
--   2. 付与 RPC 2 本に p_operation_id uuid DEFAULT NULL を足す（関数は引数が変わるので
--      DROP → CREATE。本文は 20261022230000 の最新定義の全文を写し、冪等処理だけを加えた）。
--      同じ操作 ID の 2 回目は INSERT せず、1 回目の行を {ok:true, replayed:true} で返す。
--      同じ操作 ID で別のお客様・別の店舗・別の回数券を指定したら PT409 で止める。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   p_operation_id は DEFAULT NULL なので、旧コード（操作 ID を送らない）はそのまま動く。
--   コードを先に出すと、新しい引数の関数が無いため付与が 500 になる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS grant_operation_id uuid;
ALTER TABLE public.user_packages ADD COLUMN IF NOT EXISTS grant_operation_id uuid;
ALTER TABLE public.user_subscriptions
  ADD CONSTRAINT user_subscriptions_grant_operation_id_key UNIQUE (grant_operation_id);
ALTER TABLE public.user_packages
  ADD CONSTRAINT user_packages_grant_operation_id_key UNIQUE (grant_operation_id);

DROP FUNCTION public.grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text);
DROP FUNCTION public.grant_user_package_atomic(uuid, uuid, uuid, uuid, text);

-- ----------------------------------------------------------------------------
-- 1. 月額プランの付与
--    戻り値: {ok:true, subscription:{...}, replayed:boolean} または
--            {ok:false, code:'forbidden'|'plan_not_found'|'not_customer'}
--    同じ操作 ID を別内容で使い回したら PT409。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_user_subscription_atomic(
  p_actor_id uuid, p_facility_id uuid, p_user_id uuid, p_plan_id uuid, p_notes text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_valid_months integer;
  v_row public.user_subscriptions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_user_id IS NULL OR p_plan_id IS NULL
    OR (p_notes IS NOT NULL AND char_length(p_notes) > 200) THEN
    RAISE EXCEPTION 'CUSTOMER_GRANT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members m
    WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
  -- 同じ操作 ID の再送: 1 回目の行を返す（actor の行ロックで同じ操作者の並行実行は直列化済み）。
  IF p_operation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.user_subscriptions s WHERE s.grant_operation_id = p_operation_id;
    IF FOUND THEN
      IF v_row.facility_id <> p_facility_id OR v_row.user_id <> p_user_id OR v_row.plan_id <> p_plan_id THEN
        RAISE EXCEPTION 'CUSTOMER_GRANT_OPERATION_CONFLICT' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object('ok', true, 'subscription', to_jsonb(v_row), 'replayed', true);
    END IF;
  END IF;
  SELECT sp.valid_months INTO v_valid_months
    FROM public.subscription_plans sp
    WHERE sp.id = p_plan_id AND sp.facility_id = p_facility_id
    FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.facility_id = p_facility_id AND b.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_customer');
  END IF;
  BEGIN
    INSERT INTO public.user_subscriptions (user_id, facility_id, plan_id, ends_at, notes, grant_operation_id)
      VALUES (p_user_id, p_facility_id, p_plan_id,
              clock_timestamp() + make_interval(months => v_valid_months), p_notes, p_operation_id)
      RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- 別の操作者が同じ操作 ID を先に使った（通常は起きない）。内容の照合は再送と同じ扱いにせず止める。
    RAISE EXCEPTION 'CUSTOMER_GRANT_OPERATION_CONFLICT' USING ERRCODE = 'PT409';
  END;
  RETURN jsonb_build_object('ok', true, 'subscription', to_jsonb(v_row), 'replayed', false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. 回数券の付与
--    戻り値: {ok:true, user_package:{...}, replayed:boolean} または
--            {ok:false, code:'forbidden'|'package_not_found'|'not_customer'}
--    同じ操作 ID を別内容で使い回したら PT409。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_user_package_atomic(
  p_actor_id uuid, p_facility_id uuid, p_user_id uuid, p_package_id uuid, p_notes text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_session_count integer;
  v_bonus_count integer;
  v_valid_days integer;
  v_row public.user_packages%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_user_id IS NULL OR p_package_id IS NULL
    OR (p_notes IS NOT NULL AND char_length(p_notes) > 200) THEN
    RAISE EXCEPTION 'CUSTOMER_GRANT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members m
    WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'forbidden'); END IF;
  IF p_operation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.user_packages up WHERE up.grant_operation_id = p_operation_id;
    IF FOUND THEN
      IF v_row.facility_id <> p_facility_id OR v_row.user_id <> p_user_id OR v_row.package_id <> p_package_id THEN
        RAISE EXCEPTION 'CUSTOMER_GRANT_OPERATION_CONFLICT' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object('ok', true, 'user_package', to_jsonb(v_row), 'replayed', true);
    END IF;
  END IF;
  SELECT sp.session_count, sp.bonus_count, sp.valid_days
    INTO v_session_count, v_bonus_count, v_valid_days
    FROM public.service_packages sp
    WHERE sp.id = p_package_id AND sp.facility_id = p_facility_id
    FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'package_not_found'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.facility_id = p_facility_id AND b.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_customer');
  END IF;
  BEGIN
    INSERT INTO public.user_packages
      (user_id, facility_id, package_id, sessions_total, sessions_remaining, expires_at, notes, grant_operation_id)
      VALUES (p_user_id, p_facility_id, p_package_id,
              v_session_count + v_bonus_count, v_session_count + v_bonus_count,
              clock_timestamp() + make_interval(days => v_valid_days), p_notes, p_operation_id)
      RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CUSTOMER_GRANT_OPERATION_CONFLICT' USING ERRCODE = 'PT409';
  END;
  RETURN jsonb_build_object('ok', true, 'user_package', to_jsonb(v_row), 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_user_package_atomic(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_user_package_atomic(uuid, uuid, uuid, uuid, text, uuid) TO service_role;
