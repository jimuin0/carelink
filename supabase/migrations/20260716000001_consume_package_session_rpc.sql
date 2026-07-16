-- consume_package_session: 回数券（user_packages）のセッション消費を行ロック下で原子的に処理する RPC。
--
-- 背景（事実）: admin/user-packages PATCH のセッション消費は、
--   (1) package_usage_logs への事前 SELECT で同一 booking_id の冪等チェック
--   (2) user_packages.sessions_remaining の CAS（楽観ロック）decrement
--   (3) package_usage_logs への INSERT（ログ記録）
--   を3つの別々のクエリとして順に実行していた。(2) の CAS decrement が成功した直後、(3) の
--   ログ INSERT が失敗しても catch して console.error するのみで 200 を返していたため、
--   減算は既にコミット済み・ログだけが欠落する。冪等チェック(1)はログ行の有無に依存するため、
--   ログが欠落した状態でスタッフが同じボタンを連打/リトライすると、(1)の事前チェックが
--   「未消費」と誤判定し、同一予約に対して sessions_remaining を再度 decrement できてしまう
--   （前払い回数券の二重消費＝金銭的損失）。
--
-- 修正: 姉妹関数 consume_subscription_session（20260628000001）と同型に、行ロック配下で
--   冪等チェック → decrement → package_usage_logs INSERT を1トランザクションに閉じ込める。
--   ログ INSERT が同一トランザクション内で失敗すれば decrement もロールバックされるため、
--   「減算はされたがログが無い」という不整合状態が構造的に発生し得なくなる。
--   認可（施設所有権 / 本人確認）は API ルート側で事前に実施済みのため、EXECUTE は service_role のみ。

CREATE OR REPLACE FUNCTION public.consume_package_session(
  p_user_package_id uuid,
  p_booking_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pkg              public.user_packages%ROWTYPE;
  v_now              timestamptz := now();
  v_existing_log_id  uuid;
BEGIN
  SELECT * INTO v_pkg
  FROM public.user_packages
  WHERE id = p_user_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- 冪等チェックを行ロック配下に置くことで、真の同時2リクエスト（同一 booking_id）が
  -- 両方ともここまで到達しても、後着は先着コミット後にロックを獲得し必ずログ有りを見て弾かれる。
  IF p_booking_id IS NOT NULL THEN
    SELECT id INTO v_existing_log_id
    FROM public.package_usage_logs
    WHERE user_package_id = p_user_package_id
      AND booking_id = p_booking_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'already_consumed');
    END IF;
  END IF;

  IF v_pkg.sessions_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_sessions_remaining');
  END IF;

  IF v_pkg.expires_at IS NOT NULL AND v_pkg.expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  UPDATE public.user_packages
    SET sessions_remaining = sessions_remaining - 1
    WHERE id = p_user_package_id;

  -- decrement とログ INSERT を同一トランザクションに閉じ込める（監査D2と同型の恒久修正）。
  -- ここが失敗すれば例外で関数全体がロールバックされ、decrement も取り消される。
  INSERT INTO public.package_usage_logs (user_package_id, booking_id, notes)
  VALUES (p_user_package_id, p_booking_id, p_notes);

  RETURN (
    SELECT jsonb_build_object('ok', true, 'user_package', to_jsonb(up.*))
    FROM public.user_packages up
    WHERE up.id = p_user_package_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_package_session(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.consume_package_session(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.consume_package_session(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_package_session(uuid, uuid, text) TO service_role;
