-- =============================================================================
-- 20260604_drop_anon_insert_salons_job_seekers.sql
-- L6: anon 直 INSERT 経路の物理的封鎖（発症前予防・恒久根本解決）
-- =============================================================================
--
-- 【脆弱性】
--   salons / job_seekers に対する anon ロールの INSERT RLS ポリシーが開いていた。
--   anon キーは公開JS（クライアントバンドル）に含まれ誰でも入手できるため、
--   ポリシーが開いている限り reCAPTCHA / rate-limit / サーバ側 zod 検証を一切
--   経由しない無制限・無検証のレコード投入が可能だった（構造的脆弱性）。
--
-- 【対策方針】
--   登録経路を POST /api/salons（service_role・withRoute による CSRF/RateLimit/
--   検証付き）に一本化した上で、対応する anon INSERT ポリシーを DB から削除し、
--   「サーバを通さない投入」を物理的に不能化する（症状対処でなく経路封鎖）。
--   service_role は RLS をバイパスするため、ポリシー削除後もサーバ API の挿入は動作する。
--
-- 【ドリフト耐性・冪等性】
--   ポリシー名が環境間でドリフトしている可能性（"Allow anonymous insert" /
--   "anon_insert_salons" 等の併存）に依存しないよう、pg_policies を走査して
--   「salons / job_seekers の INSERT で roles に anon を含む」ポリシーを自己発見し
--   DROP する。再実行しても対象が無くなるだけで no-op（冪等）。
--
-- 【job_seekers にコード経路が無い点】
--   現行 src/ に job_seekers への INSERT 経路は存在しない（grep 実査で確認）。
--   よって本ポリシー削除でアプリ機能の退行は発生しない。将来 job_seekers 登録を
--   実装する際も salons と同様にサーバ API 経由とする。
-- =============================================================================

DO $$
DECLARE
  r record;
  dropped_count INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('salons', 'job_seekers')
      AND cmd = 'INSERT'
      AND 'anon' = ANY (roles)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      r.policyname, r.tablename
    );
    dropped_count := dropped_count + 1;
    RAISE NOTICE 'dropped anon INSERT policy: %.% -> %', r.schemaname, r.tablename, r.policyname;
  END LOOP;

  RAISE NOTICE 'anon INSERT policy drop done: % policy(ies) dropped', dropped_count;
END $$;
