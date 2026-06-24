-- スキーマ列一覧 RPC を「1行の jsonb 集約」返しに変更し、PostgREST 行数上限の影響を恒久的に断つ。
--
-- 背景(事実・根本原因):
--   旧 get_public_columns() は RETURNS TABLE(SETOF) で 1 列 = 1 行を返していた。
--   PostgREST は RPC レスポンス行数に上限(db-max-rows / 既定 1000 行)を課すため、
--   public スキーマの総列数が 1000 を超えた時点で末尾の列行が黙って切り捨てられ、
--   /api/cron/schema-drift-check が「期待スナップショットにあるが本番に無い列(欠落)」を
--   多数のテーブルにわたって誤検知していた(2026-06-24 のドリフト警告 列差分20 がこれ)。
--   information_schema.columns は物理順で返るため、切り捨てられた列が複数テーブルに散在した。
--   実際の列欠落ではなく(本番アプリは全列を正常に読み書きできている)、RPC 側の取得欠落。
--
-- 恒久対策(発症前根治): SETOF をやめ jsonb_agg で全 (table, column) を 1 行の jsonb 配列に集約して返す。
--   返却は常に 1 行なので、今後 public スキーマの列数がいくら増えても行数上限に一切影響されない。
--   呼び出し側(schema-drift-check route)は data を [{table_name, column_name}] 配列として受け取る
--   (jsonb 配列が単一スカラ値として返るため、新旧どちらの route 実装でも data は同じ配列形になり互換)。
--
-- 副作用なし(SELECT のみ)。anon/authenticated からは実行不可(service_role 限定)。
--
-- 注意: CREATE OR REPLACE は既存関数の戻り型を変更できない(SQLSTATE 42P13)。
--   旧定義は RETURNS TABLE、新定義は RETURNS jsonb で戻り型が変わるため、先に DROP する。
DROP FUNCTION IF EXISTS public.get_public_columns();

CREATE OR REPLACE FUNCTION public.get_public_columns()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('table_name', c.table_name, 'column_name', c.column_name)
    ),
    '[]'::jsonb
  )
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
$$;

REVOKE ALL ON FUNCTION public.get_public_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_columns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_columns() TO service_role;
