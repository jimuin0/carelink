-- 点検 B9-13（2026年11月13日）：public の SECURITY DEFINER で search_path=public の関数に pg_temp を末尾で明示する。
--
-- search_path に pg_temp を書かないと、pg_temp は【先頭】で探索される。呼び出し側が一時テーブルを作れば、
-- 関数内の修飾なしの表名を横取りされ得る（SECURITY DEFINER＝所有者権限で動くので影響が大きい）。
-- 本文は変えず proconfig だけを変更する。拡張が所有する関数は対象外。
-- 新規 migration での再混入は .github/workflows/secdef-search-path-lint.yml が止める（同日強化）。
-- 適用順序：コード変更なし。いつ適用してもよい（1 段目）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DO $fix$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c IN ('search_path=public', 'search_path="public"'))
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path=public, pg_temp に変更した SECURITY DEFINER 関数: % 本', n;
END $fix$;
