-- ============================================================================
-- スキーマ・フィンガープリント（本番 / shadow の両方で同じものを実行する）
-- ============================================================================
-- 目的:
--   「期待スキーマ」を人が JSON で手管理するのをやめる。migration を使い捨て
--   Postgres に全適用した結果（= shadow）と本番を、この 1 本の SQL で同じ形に
--   落として突合する。手管理が無いので陳腐化しない。
--
-- 🔴 なぜ必要か（2026年8月2日 実測）:
--   旧方式は src/lib/schema-constraints-snapshot.json を手管理しており、
--   migration 20260722000005 が UNIQUE(facility_id,is_active) を意図的に DROP した
--   のに JSON だけ取り残され、毎日「制約欠落1」を誤報し続けていた。
--   しかも旧 RPC は pg_constraint の contype IN ('p','u') しか読まず、
--   FK / CHECK / インデックス / RLS ポリシー / 列の型・NOT NULL・DEFAULT /
--   トリガ / 関数 / enum / 権限 を【一切見ていなかった】。
--
-- 出力: 1 列 (line text) を ORDER BY した行集合。両側の結果を集合差分すれば
--   ドリフトが出る。行は「種別|対象|詳細」の固定書式。
--
-- 誤報を出さないための設計:
--   - public スキーマのみ（auth/storage 等は Supabase 管理で migration 対象外）
--   - 拡張が所有するオブジェクトは全除外（postgis のバージョン差が誤報になる）
--   - 関数本体は md5 で持つ（整形の揺れではなく実体の変化だけを見る）
--   - 内部トリガ（制約由来）は除外
--   - 列は attnum ではなく名前で識別（列順の違いを誤報にしない）
--
-- ⚠️ shadow と本番の PostgreSQL メジャーバージョンを揃えること。
--   pg_get_constraintdef / pg_get_indexdef / pg_get_expr の整形はバージョン間で
--   変わり得るため、揃えないと「差分ではない差分」が出る。
--   これは注意書きではなく機械強制されている（下の meta| 行を参照）。人が事前に
--   `SELECT current_setting('server_version_num')` を比較する運用には頼らない。
-- ============================================================================

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

  -- ── メタ: PostgreSQL の【メジャー】バージョン ────────────────────────────
  -- 🔴 これを**フィンガープリントの一部にする**（2026年8月2日）。
  --   pg_get_constraintdef / pg_get_indexdef / format_type の整形はメジャーバージョン間で
  --   変わり得る。shadow と本番のバージョンがズレていると「差分ではない差分」が大量に出て
  --   誤報になる。注意書きで運用に頼ると必ず忘れるので、**バージョン自体を比較対象に含めて
  --   食い違ったら必ず赤くなる**ようにする。
  --   【実測 2026年8月3日・この危険は仮説ではない】同一 migration 群を PG16 と PG17 の
  --   shadow に全適用して突合したところ、**スキーマは 1 箇所も違わないのに 290 行が差分**
  --   になった。PostgreSQL 17 で新しい権限 MAINTAIN が追加され、`GRANT ALL` の展開が
  --   `DELETE,INSERT,REFERENCES,...` から `DELETE,INSERT,MAINTAIN,REFERENCES,...` に
  --   変わるため。バージョン差を検知せずに突合すると **290 件のドリフト**を報告する。
  --
  -- 🔴 マイナー(パッチ)まで含めてはいけない（2026年8月3日・最初そう書いていた欠陥を修正）。
  --   server_version_num をそのまま出すと 170006 と 170008 が別物として差分になる。
  --   ・Supabase は本番のマイナーを随時上げる
  --   ・CI が使う postgis イメージのタグ（例 17-3.5）はパッチを固定していないので
  --     再 pull しただけで値が動く
  --   つまり**スキーマが 1 文字も変わっていないのに必ずいつか鳴る**＝誤報の確定装置だった。
  --   整形が変わり得るのはメジャー間であり（PostgreSQL のマイナーリリースは
  --   バグ修正のみで出力書式を変えない方針）、かつ万一変わったとしても
  --   **整形が変わった行そのものが差分に出る**。この meta 行は検出器ではなく
  --   「差分の原因がバージョン差だと即断できるようにする診断情報」なので、
  --   メジャーだけで目的を完全に満たす。
  SELECT format('meta|server_version_major|%s',
                (current_setting('server_version_num')::int / 10000)) AS line

  UNION ALL
  -- ── リレーション本体（種別と RLS の有効/強制） ──────────────────────────
  SELECT format('relation|%s|%s|rls=%s|force=%s',
                r.relname, r.relkind, r.relrowsecurity, r.relforcerowsecurity)
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
-- 🔴 COLLATE "C" が必須（2026年8月2日・CI が実装欠陥を検出）。
--   `ORDER BY line` はデータベースの照合順序(LC_COLLATE)に依存する。
--   ローカル shadow が C.UTF-8、CI の postgis イメージが en_US.utf8 だったため、
--   **中身が完全に同一なのに 218 行が並び順だけズレて差分になった**（実測）。
--   本番 Supabase の照合順序は環境依存なので、放置すれば永続的な誤報源になる。
--   COLLATE "C" はバイト順で、どの環境でも同一の並びになる（両ロケールで完全一致を実測）。
ORDER BY line COLLATE "C";
