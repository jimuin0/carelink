-- =============================================================================
-- 20260603_secdef_search_path_fixation.sql
-- L6: SECURITY DEFINER 関数の search_path injection 対策（発症前予防・恒久根本解決）
-- =============================================================================
--
-- 【脆弱性】
--   SET search_path を固定していない SECURITY DEFINER 関数は、呼び出し側が
--   search_path を操作できる（mutable search_path）。特にテーブル名解決では
--   pg_temp が暗黙で先頭検索されるため、攻撃者が一時スキーマに同名テーブルを
--   仕込むと、definer（= 所有者 postgres / superuser 相当）権限で攻撃者の
--   オブジェクトが参照され得る古典的 search_path injection 攻撃面。
--
-- 【対策方針】
--   未固定の SECURITY DEFINER 関数を本番実体（pg_proc）から自己発見し、
--   search_path を固定する。pg_get_function_identity_arguments() で実シグネチャを
--   取得するため、migration ファイルと本番のドリフトに依存しない（ドリフト耐性）。
--   既に search_path を持つ関数（例: create_booking_atomic）は除外し非破壊。
--   冪等: 再実行しても対象が無くなるだけで no-op。
--
-- 【search_path 値の根拠: public, extensions, pg_temp】
--   - pg_temp を最後に明示 → temp テーブルによる public テーブルの shadowing を封じる
--     （未明示だと pg_temp が暗黙で先頭検索される危険デフォルトのまま）。
--   - extensions を含める → 万一ドリフトで PostGIS/pgcrypto を無修飾使用する definer
--     関数が本番に在っても壊さない。extensions スキーマは untrusted ロール書込不可で
--     注入リスクなし。
--   - public → アプリテーブルの無修飾参照を維持し、既存関数本体を書き換えない非侵襲修正。
--   - pg_catalog は search_path 未明示でも常に暗黙先頭検索されるため組込関数は安全。
--   ※ Supabase advisor 推奨の `SET search_path = ''`（全参照を schema 修飾）は全関数
--     本体の書き換えを要し侵襲的。mutable search_path 解消という同等の安全性を
--     非侵襲で得る本方式を採用する。
-- =============================================================================

DO $$
DECLARE
  r record;
  fixed_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true                 -- SECURITY DEFINER のみ
      AND (
        p.proconfig IS NULL                  -- 設定そのものが無い
        OR NOT EXISTS (                      -- もしくは search_path だけ無い
          SELECT 1 FROM unnest(p.proconfig) c
          WHERE c LIKE 'search_path=%'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
      r.proname, r.args
    );
    fixed_count := fixed_count + 1;
    RAISE NOTICE 'search_path fixed: public.%(%)', r.proname, r.args;
  END LOOP;

  RAISE NOTICE 'secdef search_path fixation done: % function(s) fixed', fixed_count;
END $$;
