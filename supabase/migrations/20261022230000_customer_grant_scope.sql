-- 回数券・月額プランの付与を「その店舗を予約したことのあるお客様」に限る（2026年10月22日）。
--
-- 【それまでの状態】/api/admin/user-subscriptions と /api/admin/user-packages の POST は、
-- 付与先の user_id が UUID であることしか確かめずに service_role で INSERT していた。
-- /register から誰でも店舗オーナーになれるので、オーナーは他人の UUID（公開されている
-- review_helpful.user_id などから集められる）を指定して付与でき、続く GET の一覧で
-- その人の profiles.display_name と profiles.email を受け取れた。付与された側の
-- /mypage には見覚えのない店舗の回数券・プランが表示される。
-- さらに RLS（user_subscriptions_admin＝FOR ALL、user_packages_facility_insert /
-- _update）が owner / admin に任意の user_id での INSERT / UPDATE を許していたため、
-- PostgREST を直接叩けば API の確認も通らなかった。
--
-- 【付与先の条件＝その店舗の予約者（bookings.user_id）】
--   customers 表には user_id 列が無いので、店舗とアカウントを結ぶ事実はこれしか無い。
--   bookings.user_id は来院者本人の予約でしか入らない（店舗の電話予約
--   create_manual_booking_atomic は user_id を NULL で作り、ブラウザには bookings の
--   INSERT / UPDATE 権が無い）ので、店舗側からは作れない。管理画面に付与先を選ぶ UI は無く、
--   店舗が user_id を知る正規の手段は自店の予約一覧（bookings_facility_member_read）だけである。
--
-- 【この migration で入れるもの】
--   1. 付与 RPC 2 本（service_role 専用）。今もその店舗の owner / admin かを行ロックつきで
--      確かめ、プラン／回数券がその店舗のものであること、付与先がその店舗の予約者であることを、
--      INSERT と同じトランザクションで確かめる。
--   2. 一覧用の RPC 1 本（service_role 専用）。表示名とメールを、その店舗の予約者に限って返す。
--      予約者のメールと氏名は店舗が予約一覧で既に見られる情報で、それ以外の人の情報は返さない。
--   3. ブラウザ（anon / authenticated）からの INSERT / UPDATE / DELETE を撤回する。
--      アプリはこの 2 表を service_role でしか書いていない（付与・状態変更・利用記録とも
--      /api/admin/* 経由）。読み取りは残す（店舗の一覧・本人の /mypage のポリシーと、
--      subscription_usage_logs / package_usage_logs のポリシーがこの 2 表を参照するため）。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   追加と撤回のどちらも「今デプロイされているコード」を壊さない（旧コードは service_role で
--   直接 INSERT しており、ブラウザからは書いていない）。新しいコードは上の RPC を呼ぶので、
--   コードを先に出すと付与と一覧（月額プラン・回数券の管理画面）が 500 になる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- ----------------------------------------------------------------------------
-- 1. 月額プランの付与
--    戻り値: {ok:true, subscription:{...}} または
--            {ok:false, code:'forbidden'|'plan_not_found'|'not_customer'}
--    （同じ表の consume_subscription_session と同じ形。API がコードを HTTP に対応させる）
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.grant_user_subscription_atomic(
  p_actor_id uuid, p_facility_id uuid, p_user_id uuid, p_plan_id uuid, p_notes text DEFAULT NULL
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
  INSERT INTO public.user_subscriptions (user_id, facility_id, plan_id, ends_at, notes)
    VALUES (p_user_id, p_facility_id, p_plan_id,
            clock_timestamp() + make_interval(months => v_valid_months), p_notes)
    RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'subscription', to_jsonb(v_row));
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. 回数券の付与
--    戻り値: {ok:true, user_package:{...}} または
--            {ok:false, code:'forbidden'|'package_not_found'|'not_customer'}
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.grant_user_package_atomic(
  p_actor_id uuid, p_facility_id uuid, p_user_id uuid, p_package_id uuid, p_notes text DEFAULT NULL
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
  INSERT INTO public.user_packages
    (user_id, facility_id, package_id, sessions_total, sessions_remaining, expires_at, notes)
    VALUES (p_user_id, p_facility_id, p_package_id,
            v_session_count + v_bonus_count, v_session_count + v_bonus_count,
            clock_timestamp() + make_interval(days => v_valid_days), p_notes)
    RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'user_package', to_jsonb(v_row));
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. 一覧に出す表示名とメール: その店舗の予約者に限る
--    呼び出し元が今もその店舗の owner / admin でなければ 0 行。
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.list_facility_customer_profiles(
  p_actor_id uuid, p_facility_id uuid, p_user_ids uuid[]
) RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.id, p.display_name, p.email
  FROM public.profiles p
  WHERE p.id = ANY (p_user_ids)
    AND EXISTS (
      SELECT 1 FROM public.facility_members m
      WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.facility_id = p_facility_id AND b.user_id = p.id
    );
$$;

REVOKE ALL ON FUNCTION public.grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_user_package_atomic(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_user_package_atomic(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. ブラウザからの直接書き込みを閉じる（権限とポリシーの両方。どちらか片方が戻っても開かない）
--    テーブル単位の REVOKE ALL は SELECT も外すので、直後に SELECT だけを付け直す。
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.user_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.user_packages FROM anon, authenticated;
GRANT SELECT ON public.user_subscriptions TO anon, authenticated;
GRANT SELECT ON public.user_packages TO anon, authenticated;

-- user_subscriptions_admin は FOR ALL（＝書き込みも許可）だった。店舗が契約者一覧を
-- 読む条件はそのままに、読み取り専用へ置き換える。
DROP POLICY IF EXISTS user_subscriptions_admin ON public.user_subscriptions;
CREATE POLICY user_subscriptions_admin_read ON public.user_subscriptions
  FOR SELECT TO authenticated
  USING (
    facility_id IN (
      SELECT fm.facility_id FROM public.facility_members fm
      WHERE fm.user_id = (SELECT auth.uid()) AND fm.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS user_packages_facility_insert ON public.user_packages;
DROP POLICY IF EXISTS user_packages_facility_update ON public.user_packages;
