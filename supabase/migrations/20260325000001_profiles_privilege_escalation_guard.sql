-- profiles 自己権限昇格ガード（2026-03-25 / 順序: 20260324_profiles_admin_columns の直後）
--
-- 背景（事実・確認済み）:
--   20260323_phase2_users_search.sql:21 の
--     CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
--   には「どのカラムを更新できるか」を縛る WITH CHECK が無い。
--   一方 20260324_profiles_admin_columns.sql で profiles に role / is_platform_admin が
--   追加され、src/types/database.types.ts の profiles Update 型に両カラムが露出している
--   （= PostgREST の PATCH /rest/v1/profiles?id=eq.<self> で書き込み可能）。
--   その結果、一般ログインユーザーが自分の行に対し
--     { "is_platform_admin": true, "role": "admin" }
--   を送るだけでプラットフォーム管理者へ自己昇格でき、role='admin' /
--   is_platform_admin=TRUE を信頼する全 RLS（audit_logs / facility_reviews_admin /
--   referral_uses / content_moderation / feature_flags / cron_logs / area_seo_contents、
--   および newsletter / community / recruitment / white_label / featured_slots の
--   platform-admin ゲート）が突破される重大な権限昇格だった。
--
-- 対応（恒久・真の予防）:
--   RLS の WITH CHECK は「行が条件を満たすか」は縛れても「どの列を変えたか」を
--   汎用に縛りにくい（PostgREST はクライアントが選んだ列だけを UPDATE する）。
--   そのため BEFORE UPDATE トリガで、PostgREST が用いる DB ロール
--   （authenticated / anon）からの role / is_platform_admin の変更を物理的に拒否する。
--   service_role・postgres・supabase_admin（= サーバ側 service role / Dashboard / 本 migration）
--   は従来どおり管理者付与を実行できる。これによりカラム露出の有無に関係なく、
--   PostgREST 経由の昇格を確実に遮断する（症状ブロックでなく根本遮断）。
--
-- 冪等性: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS で再適用安全。
--
-- ★ SECURITY INVOKER（= SECURITY DEFINER を付けない）であることが必須:
--   SECURITY DEFINER にすると関数内の current_user が「呼び出し元ロール」ではなく
--   「関数の定義者(postgres)」を返してしまい、下の current_user 判定が常に false になって
--   トリガが昇格を素通しさせる（本番で実測・2026-03-25 にロールバック付き攻撃テストで確認）。
--   SECURITY INVOKER なら current_user は UPDATE を実行した実ロール（PostgREST が JWT 検証後に
--   SET ROLE する authenticated / anon / service_role）を返し、クライアント詐称不可で堅牢。

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- PostgREST がクライアントリクエストで用いる DB ロールは 'authenticated' / 'anon'。
  -- これらのロールが role / is_platform_admin を変更しようとしたら拒否する。
  -- service_role / postgres / supabase_admin 等の管理ロールはバイパス（管理付与可）。
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'permission denied: cannot modify profiles.role';
    END IF;
    IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
      RAISE EXCEPTION 'permission denied: cannot modify profiles.is_platform_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
