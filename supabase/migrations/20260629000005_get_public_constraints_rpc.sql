-- 制約レベル（PRIMARY KEY / UNIQUE）のスキーマドリフトを発症前検知するための introspection RPC。
--
-- 背景（事実・2026年6月29日）:
--   既存の get_public_columns() / schema-drift-check cron は「テーブル存在＋列名」しか突合せず、
--   PK/UNIQUE の構成変更（out-of-band な制約の付け替え・欠落）を検知できなかった。
--   実際、本番で review_helpful の PK が複合→id へ、features の slug UNIQUE 追加、
--   coupon_redemptions の PK 欠落（クーポン予約のライブ障害）など、制約レベルのドリフトが
--   複数 out-of-band で発生していたが、いずれも列名ベースの監視では無音だった。
--
-- 本 RPC: public スキーマの全テーブルの PRIMARY KEY / UNIQUE 制約を
--   [{table_name, kind('p'|'u'), columns('col1,col2' をattname昇順でカンマ連結)}] の
--   1行 jsonb 配列で返す（get_public_columns と同じく PostgREST 行数上限の影響を受けない集約返し）。
--   schema-drift-check cron が期待スナップショット（schema-constraints-snapshot.json）と突合し、
--   差分（out-of-band 追加＝extra / 欠落＝missing）を Slack 警告する。
--
-- 副作用なし（SELECT のみ）。anon/authenticated からは実行不可（service_role 限定）。
CREATE OR REPLACE FUNCTION public.get_public_constraints()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_name', t.relname,
        'kind', c.contype::text,
        'columns', cols.columns
      )
    ),
    '[]'::jsonb
  )
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  CROSS JOIN LATERAL (
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) AS columns
    FROM pg_catalog.unnest(c.conkey) AS k(attnum)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  ) cols
  WHERE n.nspname = 'public'
    AND c.contype IN ('p', 'u')
    AND t.relkind = 'r'
$$;

REVOKE ALL ON FUNCTION public.get_public_constraints() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_constraints() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_constraints() TO service_role;
