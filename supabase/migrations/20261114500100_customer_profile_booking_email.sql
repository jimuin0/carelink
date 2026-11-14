-- 店舗の管理画面に出すお客様のメールを「予約時に入力したもの」に揃える（点検 A414・2026年11月14日）。
--
-- 【それまでの状態】list_facility_customer_profiles（回数券・月額プランの契約者一覧で使う）は
-- profiles.email をそのまま店舗へ返していた。profiles.email は本人がいつでも書き換えられ、
-- ログイン用のアドレスと同じこともあるため、お客様が店舗に伝えていないアドレスが店舗に見えていた。
--
-- 【本人の決定】店舗に見せるメールは、その店舗の予約でお客様が入力したもの（bookings.email の
-- 最新のもの）に揃える。ログイン用・プロフィールのアドレスは店舗に見せない。
--
-- 【この migration で変えること】最終定義＝20261022230000_customer_grant_scope.sql の全文を写し、
-- email 列を「その店舗のその人の予約のうち最も新しい（created_at, id の降順）bookings.email」に
-- 替えた以外は一字一句同じ（引数・戻り値の型・SECURITY INVOKER・search_path・権限は不変）。
-- 予約のメールが空文字なら NULL を返す。
--
-- 【本番の適用順序】どちらが先でもよい（アプリは列名・型を変えずに読むだけ）。
--   既存データは書き換えない。適用した時点から一覧のメールが予約時の入力値に変わる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.list_facility_customer_profiles(
  p_actor_id uuid, p_facility_id uuid, p_user_ids uuid[]
) RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.id, p.display_name,
    (SELECT nullif(b.email, '')
       FROM public.bookings b
      WHERE b.facility_id = p_facility_id AND b.user_id = p.id
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT 1) AS email
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

REVOKE ALL ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_facility_customer_profiles(uuid, uuid, uuid[]) TO service_role;
