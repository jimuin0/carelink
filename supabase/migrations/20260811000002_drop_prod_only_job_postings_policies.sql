-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.job_postings') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.job_postings が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- job_postings: 本番にだけ生存していた out-of-band RLS ポリシー 2 件の駆除（2026-08-11）
-- ============================================================================
-- 【発見経緯】日次 schema-drift 監視が、migration に定義の無い RLS ポリシーが
--   本番の job_postings に 2 件存在することを検出した:
--     1. "Anyone can read published jobs"
--        （PUBLIC/anon SELECT、status='公開' 相当の条件）
--     2. "Service role full access on job_postings"
--        （service_role 向け全操作許可）
--
-- 【1. "Anyone can read published jobs" — 意図しない公開露出】
--   supabase/migrations/20260320000002_prod_only_base_tables.sql の job_postings
--   CREATE TABLE 直後のコメントに明記されている設計は
--   「RLS 有効・ポリシー無し＝anon/authenticated は不可視（service_role のみ）。
--   安全側に倒す。」であり、anon への SELECT 許可は migration 側で一度も
--   意図されていない。神原さんに確認済み：求人情報は公開しない方針。
--   このポリシーは migration を経由しない out-of-band 作成であり、
--   本テーブルを anon から読める状態にしてしまっていた＝意図しない公開露出。
--
-- 【2. "Service role full access on job_postings" — 機能的に冗長】
--   service_role は RLS を常にバイパスする（Postgres/Supabase の性質）ため、
--   service_role 向けの許可ポリシーはあってもなくても service_role の挙動を
--   変えない。存在自体が実害を生むわけではないが、
--   「ポリシー0件=default-deny」という設計の見通しを悪くし、将来 anon 等へ
--   ロールを取り違えて複製されるリスクを持つため、意図しない残骸として
--   併せて駆除する。
--
-- 【本 migration の方針】
--   上記 20260320000002 が定めた設計（RLS 有効・ポリシー 0 件）へ本番を収斂させる。
--   個別の名前指定 DROP ではなく、pg_policies を動的走査して job_postings 上の
--   ポリシーを「存在するものは全て」削除するプロパティベースの実装にする
--   （バイト単位の名前不一致があっても確実に捕まえる。将来何らかの理由で
--   別名のポリシーが増えてもこの migration を再実行すれば駆除できる。
--   「対象を列挙して塞ぐ」は対象追加を見逃す class のため、ここでは使わない）。
--   最後に pg_policies を再照会し、0 件でなければ migration ごと失敗させる
--   自己検証（fail-closed）を置く。
--
-- 【expected.json は変更不要（regenerate 不要・PG17 不要）】
--   src/lib/schema-fingerprint.expected.json は既に
--     - "relation|job_postings|r|rls=t|force=f" を含み（RLS 有効）
--     - "policy|job_postings|..." を1行も含まない（ポリシー0件）
--   という、本 migration 適用後の本番と一致する状態になっている
--   （20260320000002 が定義した設計どおりに fresh-apply されているため）。
--   したがって本番へこの migration を適用しても shadow 側の期待値は変わらず、
--   expected.json の再生成も、それに要する PG17 環境も必要ない。
--
-- 【冪等性】
--   新規（fresh）shadow DB は最初から job_postings にポリシーを持たない
--   （20260320000002 が ENABLE ROW LEVEL SECURITY のみでポリシーを作らないため）ので、
--   動的走査ループは 0 回反復して no-op、count=0 で自己検証も通る。
--   本番適用時は 2 件を実際に削除して count=0 に到達する。
--   どちらの場合も再実行して安全（2回目以降は全 DROP が IF EXISTS で no-op）。
-- ============================================================================

-- ── 動的走査 DROP：job_postings 上の全ポリシーを名前によらず削除 ──────────────
DO $$
DECLARE
  pol record;
  dropped int := 0;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'job_postings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_postings', pol.policyname);
    dropped := dropped + 1;
  END LOOP;

  IF dropped > 0 THEN
    RAISE NOTICE 'job_postings: 動的走査で % 件のポリシーを削除した', dropped;
  END IF;
END $$;

-- RLS は有効のまま維持する（既に有効なら no-op）。
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 自己検証（fail-closed。1件でも残っていれば migration ごと失敗する）
-- ============================================================================
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'job_postings';

  IF remaining > 0 THEN
    RAISE EXCEPTION 'job_postings に % 件のポリシーが残っています（DROP に失敗した可能性）。手動で pg_policies を確認してください。', remaining;
  END IF;
END $$;
