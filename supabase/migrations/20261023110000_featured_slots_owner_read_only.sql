-- 有料の広告枠（featured_slots）を店舗が自分で作れないようにする（2026年10月23日）。
--
-- 【穴】20260417000014 のポリシー featured_slots_owner は FOR ALL で WITH CHECK が無く、
--   「その施設の owner / admin か」という USING がそのまま INSERT / UPDATE の検査を兼ねていた。
--   authenticated には表単位の INSERT / UPDATE / DELETE 権もあった。そのため /register から
--   店舗を作って公開したオーナーなら誰でも、自分のトークンで PostgREST を直接叩いて
--     POST /rest/v1/featured_slots {"facility_id":"<自店>","slot_type":"search_top",
--                                    "starts_at":"<今>","ends_at":"2099-01-01T00:00:00Z"}
--   を作れた（is_active の既定値は true、area / business_type を省くと NULL＝全エリア・全業種）。
--   以後 /search の 1 ページ目では、どの検索でもその店舗が「スポンサー」として最上部に出る。
--   決済も運営の確認も通らない。/api/admin/featured-ads が is_active=false で作った未払いの行も
--   PATCH {"is_active":true} で有効化でき、支払い済みの枠の ends_at を延ばすこともできた。
--   featured_slots_platform_admin も同じ FOR ALL の形だった。
--
-- 【対処】
--   * 2 本のポリシーを読み取り専用（FOR SELECT TO authenticated）に置き換える。条件は従来と同じ
--     （自施設の owner / admin、またはプラットフォーム管理者）。TO authenticated にしたので、
--     anon の読み取り（検索のスポンサー表示）は featured_slots_public_read だけで判定される。
--   * anon / authenticated から書き込み権（INSERT / UPDATE / DELETE / TRUNCATE ほか）を撤回し、
--     SELECT だけを付け直す。service_role は従来どおり全権。
--   * is_active の既定値を false にする（書き忘れた行が即座に表示されない側へ倒す）。
--     アプリの INSERT は常に is_active を明示している（/api/admin/featured-ads は false）。
--
-- 【書き込み経路】すべて service_role で、この migration の影響を受けない:
--   /api/admin/featured-ads（GET 一覧・POST で is_active=false の行を作成）と
--   /api/stripe/webhook（決済完了で is_active=true）。ブラウザ（anon / authenticated）から
--   featured_slots を読み書きするコードは旧アプリ・新アプリとも 1 箇所も無い
--   （管理画面 /admin/featured-ads も API を通す。検索のスポンサー表示は anon の読み取りだけ）。
-- 【適用順序】アプリのデプロイの前後どちらでもよい（旧アプリもブラウザから書き込んでいない）。
-- 【既存の行】この migration はデータに触れない。本番は 0 行の想定。棚卸しは
--   scripts/diagnose-featured-slots-and-account-ids.sql で行う。
-- 実 DB での検証は supabase/shadow/featured-slots-account-ids-fixtures.sql（CI の schema-fingerprint）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

DROP POLICY IF EXISTS featured_slots_owner ON public.featured_slots;
DROP POLICY IF EXISTS featured_slots_owner_read ON public.featured_slots;
CREATE POLICY featured_slots_owner_read ON public.featured_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_members fm
      WHERE fm.facility_id = featured_slots.facility_id
        AND fm.user_id = (SELECT auth.uid())
        AND fm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS featured_slots_platform_admin ON public.featured_slots;
DROP POLICY IF EXISTS featured_slots_platform_admin_read ON public.featured_slots;
CREATE POLICY featured_slots_platform_admin_read ON public.featured_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_platform_admin = true
    )
  );

-- テーブル単位の REVOKE ALL は SELECT も外すので、直後に付け直す。
REVOKE ALL ON public.featured_slots FROM anon, authenticated;
GRANT SELECT ON public.featured_slots TO anon, authenticated;
GRANT ALL ON public.featured_slots TO service_role;

ALTER TABLE public.featured_slots ALTER COLUMN is_active SET DEFAULT false;
