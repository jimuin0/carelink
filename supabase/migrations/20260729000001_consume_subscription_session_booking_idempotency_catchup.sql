-- consume_subscription_session の booking_id 冪等化(監査D2)を migration 履歴に事後記録する catch-up。
--
-- 背景(事実): PR#404/#405(2026年7月4日マージ)で、本関数を p_subscription_id のみの1引数版から
--   p_booking_id/p_notes を受け取り行ロック配下で冪等チェック+ログINSERTまで内包する3引数版へ
--   切り替える DDL を、神原さんが Supabase SQL Editor で直接適用した(PR#404 本文「別途 神原さん対応
--   (DDL・会話で全文提示)」/ PR#405 本文「DB側RPC(神原さんがSupabase SQL Editorで適用済み)」)。
--   アプリ側(route.ts)は PR#405 で3引数呼び出しに追随したが、この DDL を反映した migration
--   ファイルが一切コミットされておらず、migrations/ を頭から再生した場合に本番の実体と異なる
--   (20260628000001 の古い1引数版が復元される)ドリフトが生じていた。
-- 本 migration の内容は 2026-07-29 に本番へ `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE
--   proname = 'consume_subscription_session'` を実行し取得した実体をそのまま転記したものであり、
--   新規の挙動変更は無い(CREATE OR REPLACE のため本番へ再適用しても冪等・無害)。

CREATE OR REPLACE FUNCTION public.consume_subscription_session(
  p_subscription_id uuid,
  p_booking_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
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

  -- 冪等ガード: 行ロック配下でのチェックのため、同時呼び出しはロック解放待ちで直列化され
  -- すり抜け不能(先着コミット後に後着がロックを獲得 → 先着のログが必ず見える)。
  IF p_booking_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.subscription_usage_logs
    WHERE subscription_id = p_subscription_id AND booking_id = p_booking_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_consumed');
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

  -- ログ挿入も同一トランザクション内。UNIQUE違反時はトランザクション全体がロールバックされる
  -- (uq_subscription_usage_logs_booking, 既存migration)ため、上記EXISTSチェックの後の
  -- もう一段の防御になる(本来この行に到達する時点でEXISTSはfalseのはず)。
  INSERT INTO public.subscription_usage_logs (subscription_id, booking_id, notes)
  VALUES (p_subscription_id, p_booking_id, p_notes);

  RETURN (
    SELECT jsonb_build_object('ok', true, 'subscription', to_jsonb(us.*))
    FROM public.user_subscriptions us
    WHERE us.id = p_subscription_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_subscription_session(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_subscription_session(uuid, uuid, text) TO service_role;
