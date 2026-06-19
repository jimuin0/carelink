-- スキーマドリフト監視用: public スキーマの (table, column) 一覧を返す読み取り専用 RPC。
--
-- 背景(事実): 既存のドリフトゲートは「migration ↔ database.types.ts(生成時スナップショット)」の
--   オフライン突合(migration-prod-drift)と「staging DB の特定RPC存在確認」(schema-invariants)のみで、
--   **live 本番スキーマを一度も見ない**。そのため本番への out-of-band 手動変更
--   (例: 他プロジェクトの migration SQL を誤って本番 SQL Editor で実行)を検知できない。
--   2026-06-19 に soel の hpb_menu_durations が CareLink 本番へ誤適用されていた事象がこれに該当。
--
-- 本 RPC を本番環境の定期 cron(/api/cron/schema-drift-check)が service_role で呼び、
-- 同梱の期待スナップショット(database.types.ts 由来)と突合して、混入/欠落を発症前に Slack 検知する。
-- 副作用なし(SELECT のみ)。anon/authenticated からは実行不可(service_role 限定)。
CREATE OR REPLACE FUNCTION public.get_public_columns()
RETURNS TABLE (table_name text, column_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.table_name::text, c.column_name::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
$$;

REVOKE ALL ON FUNCTION public.get_public_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_columns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_columns() TO service_role;
