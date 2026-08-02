-- 本番スキーマの完全フィンガープリントを返す introspection RPC。
--
-- 🔴 なぜ要るか（2026年8月2日 実測）:
--   既存の get_public_columns() は「テーブル存在＋列【名】」だけ、
--   get_public_constraints() は pg_constraint の contype IN ('p','u') だけを見ていた。
--   その結果、次が【一切監視されていなかった】:
--     列の型 / NOT NULL / DEFAULT、FOREIGN KEY、CHECK、インデックス（部分ユニーク含む）、
--     RLS ポリシー（実測 131 本＝施設間データ分離の実体）、トリガ、関数本体、enum、GRANT。
--   加えて期待値を src/lib/schema-constraints-snapshot.json で人が手管理していたため、
--   migration 20260722000005 が UNIQUE(facility_id,is_active) を意図的に DROP した際に
--   JSON だけ取り残され、**毎日「制約欠落1」を誤報し続けていた**。
--
--   本 RPC は shadow DB（migration を使い捨て Postgres に全適用したもの）に対して
--   実行するのと**完全に同一の SQL**を本番で実行する。両者を突合するので、
--   期待値の手管理が構造的に不要になる。
--
-- ⚠️ 本文は scripts/schema-fingerprint.sql からの【機械転記】。手で編集しないこと。
--   両者が 1 文字でもズレると突合が無意味になるため、CI
--   （src/lib/__tests__/schema-fingerprint-rpc-parity.test.ts）が同一性を強制する。
--
-- 返却: 1 個の jsonb 配列（PostgREST の 1000 行上限を受けない集約返し。実測 2027 項目）。
-- 副作用なし（SELECT のみ）。anon/authenticated からは実行不可（service_role 限定）。

CREATE OR REPLACE FUNCTION public.get_schema_fingerprint()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fingerprint$
  SELECT coalesce(jsonb_agg(q.line ORDER BY q.line), '[]'::jsonb)
  FROM (
-- >>> BEGIN scripts/schema-fingerprint.sql（自動転記・手で編集しない） >>>
WITH ext_objs AS (
  -- 拡張が所有する oid（テーブル/関数/型）を全部集める
  SELECT objid FROM pg_depend WHERE deptype = 'e'
),
rels AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND c.oid NOT IN (SELECT objid FROM ext_objs)
)
-- 🔴 改行と連続空白を 1 個の半角空白に潰してから返す（2026年8月2日・自分の欠陥を敵対検証で発見）。
--   pg_get_expr / pg_get_indexdef / pg_get_constraintdef は **複数行の文字列**を返す。
--   そのまま出すと 1 レコードが複数行に割れ、行単位の集合差分が成立しない
--   （最初にそう書いて、2185 行のうち RLS 式が 100 行以上に飛び散った）。
--   副次効果として、整形の揺れ（改行位置・インデント）が差分にならなくなる＝誤報が減る。
SELECT regexp_replace(line, '\s+', ' ', 'g') AS line FROM (

  -- ── リレーション本体（種別と RLS の有効/強制） ──────────────────────────
  SELECT format('relation|%s|%s|rls=%s|force=%s',
                r.relname, r.relkind, r.relrowsecurity, r.relforcerowsecurity) AS line
  FROM rels r

  UNION ALL
  -- ── 列（型・NOT NULL・DEFAULT・生成列）────────────────────────────────
  -- 旧方式は列【名】しか見ておらず、型変更や NOT NULL 解除が無音だった。
  SELECT format('column|%s.%s|%s|notnull=%s|default=%s|generated=%s',
                r.relname, a.attname,
                format_type(a.atttypid, a.atttypmod),
                a.attnotnull,
                coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
                a.attgenerated)
  FROM rels r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = r.oid AND ad.adnum = a.attnum

  UNION ALL
  -- ── 制約（全 contype: p/u/f/c/x）──────────────────────────────────────
  -- 旧 RPC は 'p','u' だけ。FK と CHECK は完全に死角だった。
  SELECT format('constraint|%s|%s|%s|%s',
                r.relname, c.contype, c.conname, pg_get_constraintdef(c.oid))
  FROM rels r
  JOIN pg_constraint c ON c.conrelid = r.oid

  UNION ALL
  -- ── インデックス（部分ユニークを含む）────────────────────────────────
  -- 🔴 部分ユニークインデックスは pg_constraint に行を作らないため、旧方式では
  --    構造的に検知不能だった。intake_form_templates の
  --    uq_intake_active_per_facility がまさにこれ。
  SELECT format('index|%s|%s|%s', r.relname, i.relname, pg_get_indexdef(i.oid))
  FROM rels r
  JOIN pg_index x ON x.indrelid = r.oid
  JOIN pg_class i ON i.oid = x.indexrelid
  WHERE i.oid NOT IN (SELECT objid FROM ext_objs)

  UNION ALL
  -- ── RLS ポリシー ──────────────────────────────────────────────────────
  -- マルチテナント分離の実体。旧方式は 1 本も見ていなかった。
  SELECT format('policy|%s|%s|cmd=%s|permissive=%s|roles=%s|using=%s|check=%s',
                r.relname, p.polname, p.polcmd,
                CASE p.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                coalesce((SELECT string_agg(rolname, ',' ORDER BY rolname)
                          FROM pg_roles WHERE oid = ANY(p.polroles)), 'PUBLIC'),
                coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  FROM rels r
  JOIN pg_policy p ON p.polrelid = r.oid

  UNION ALL
  -- ── トリガ（内部トリガ＝制約由来は除外）──────────────────────────────
  SELECT format('trigger|%s|%s|%s', r.relname, t.tgname, pg_get_triggerdef(t.oid))
  FROM rels r
  JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal

  UNION ALL
  -- ── 関数 / RPC（本体は md5・整形の揺れを差分にしない）──────────────────
  SELECT format('function|%s(%s)|returns=%s|volatile=%s|secdef=%s|body_md5=%s',
                p.proname,
                pg_get_function_identity_arguments(p.oid),
                pg_get_function_result(p.oid),
                p.provolatile, p.prosecdef,
                md5(coalesce(p.prosrc, '')))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.oid NOT IN (SELECT objid FROM ext_objs)

  UNION ALL
  -- ── enum 型とラベル ───────────────────────────────────────────────────
  SELECT format('enum|%s|%s', t.typname,
                (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                 FROM pg_enum e WHERE e.enumtypid = t.oid))
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
  WHERE t.typtype = 'e' AND t.oid NOT IN (SELECT objid FROM ext_objs)

  UNION ALL
  -- ── テーブル権限（anon/authenticated/service_role のみ）────────────────
  -- RLS を張っても GRANT が広すぎれば漏れる。逆に GRANT が消えれば機能が死ぬ。
  -- ⚠️ information_schema を使わないこと。本番側は同じ SQL を
  --   `SET search_path = ''` の SECURITY DEFINER 関数として実行するため、
  --   information_schema は解決できない（pg_catalog だけが暗黙に引かれる）。
  SELECT format('grant|%s|%s|%s', r.relname, grantee.rolname,
                string_agg(acl.privilege_type, ',' ORDER BY acl.privilege_type))
  FROM rels r
  CROSS JOIN LATERAL pg_catalog.aclexplode(r.relacl) AS acl
  JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
  WHERE grantee.rolname IN ('anon', 'authenticated', 'service_role')
  GROUP BY r.relname, grantee.rolname

) s
ORDER BY line
-- <<< END scripts/schema-fingerprint.sql <<<
  ) q;
$fingerprint$;

REVOKE ALL ON FUNCTION public.get_schema_fingerprint() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_schema_fingerprint() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_schema_fingerprint() TO service_role;
