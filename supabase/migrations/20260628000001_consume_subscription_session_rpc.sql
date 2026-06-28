-- consume_subscription_session: サブスクのセッション消費を行ロック下で原子的に処理する RPC。
--
-- 背景(事実): admin/user-subscriptions PATCH のセッション消費は CAS で同時インクリメントは
--   守れたが、月次リセットの無条件 UPDATE(sessions_used_this_month=0)が CAS の外にあったため、
--   リセット境界で2リクエストが同時に走ると後発のリセットが先発のインクリメントを上書きし、
--   月上限を超えて消費される競合があった(消費の取りこぼし)。
-- 修正: 月次リセット・上限判定・インクリメントを SELECT ... FOR UPDATE 配下に閉じ込め、
--   read-modify-write を直列化して競合を物理的に不能化する。
-- 認可・booking 検証・利用ログ記録は API ルート側で実施するため、EXECUTE は service_role のみ。

CREATE OR REPLACE FUNCTION public.consume_subscription_session(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub         public.user_subscriptions%ROWTYPE;
  v_per_month   integer;
  v_used        integer;
  v_now         timestamptz := now();
  v_next_reset  timestamptz;
BEGIN
  SELECT * INTO v_sub
  FROM public.user_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'inactive');
  END IF;

  IF v_sub.ends_at IS NOT NULL AND v_sub.ends_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  SELECT sessions_per_month INTO v_per_month
  FROM public.subscription_plans
  WHERE id = v_sub.plan_id;
  v_per_month := COALESCE(v_per_month, 4);

  v_used := v_sub.sessions_used_this_month;
  IF v_sub.month_reset_at IS NOT NULL AND v_now >= v_sub.month_reset_at THEN
    v_used := 0;
    v_next_reset := date_trunc('month', v_now) + interval '1 month';
  ELSE
    v_next_reset := v_sub.month_reset_at;
  END IF;

  IF v_used >= v_per_month THEN
    IF v_next_reset IS DISTINCT FROM v_sub.month_reset_at THEN
      UPDATE public.user_subscriptions
        SET sessions_used_this_month = 0,
            month_reset_at = v_next_reset
        WHERE id = p_subscription_id;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'cap_reached', 'limit', v_per_month);
  END IF;

  UPDATE public.user_subscriptions
    SET sessions_used_this_month = v_used + 1,
        month_reset_at = v_next_reset
    WHERE id = p_subscription_id;

  RETURN (
    SELECT jsonb_build_object('ok', true, 'subscription', to_jsonb(us.*))
    FROM public.user_subscriptions us
    WHERE us.id = p_subscription_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid) FROM public;
REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_subscription_session(uuid) TO service_role;
