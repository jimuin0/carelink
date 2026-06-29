/**
 * スキーマドリフト判定（純粋関数・副作用なし）。
 *
 * 期待スキーマ(database.types.ts 由来の schema-snapshot.json)と
 * 本番スキーマ(RPC get_public_columns の結果)を突合し、
 * 混入(contaminated)/欠落(missing)/列差分(colDrift)を返す。
 *
 * システム/バックアップ系オブジェクトは監視対象外(誤報防止):
 *   - PostGIS システム: spatial_ref_sys / geography_columns / geometry_columns
 *   - バックアップ: 接頭辞 `_backup_` のテーブル
 */

const IGNORE = new Set<string>([
  'spatial_ref_sys',
  'geography_columns',
  'geometry_columns',
]);

/** 監視対象外か(PostGIS システム or _backup_ 接頭辞)。 */
export function isIgnored(table: string): boolean {
  return IGNORE.has(table) || table.startsWith('_backup_');
}

export interface SchemaRow {
  table_name: string;
  column_name: string;
}

export interface DriftResult {
  /** 本番にあるが期待に無いテーブル(= out-of-band 混入の疑い)。 */
  contaminated: string[];
  /** 期待にあるが本番に無いテーブル(= migration 未適用 / 誤削除)。 */
  missing: string[];
  /** 列差分のあるテーブル("table(+extra/-missing)" 形式)。 */
  colDrift: string[];
}

/**
 * 期待スキーマ {table: [cols]} と本番列行 [{table_name, column_name}] を突合。
 * 監視対象外テーブルは両側で除外する。
 */
export function computeDrift(
  expected: Record<string, string[]>,
  rows: SchemaRow[],
): DriftResult {
  const prod = new Map<string, Set<string>>();
  for (const r of rows) {
    if (isIgnored(r.table_name)) continue;
    let set = prod.get(r.table_name);
    if (!set) {
      set = new Set();
      prod.set(r.table_name, set);
    }
    set.add(r.column_name);
  }

  const contaminated: string[] = [];
  const missing: string[] = [];
  const colDrift: string[] = [];

  const names = new Set<string>([...Object.keys(expected), ...prod.keys()]);
  for (const t of [...names].sort()) {
    if (isIgnored(t)) continue;
    const exp = expected[t];
    const got = prod.get(t);
    if (!got) {
      missing.push(t);
      continue;
    }
    if (!exp) {
      contaminated.push(t);
      continue;
    }
    const expSet = new Set(exp);
    const extra = [...got].filter((c) => !expSet.has(c)).sort();
    const lack = exp.filter((c) => !got.has(c)).sort();
    if (extra.length > 0 || lack.length > 0) {
      colDrift.push(`${t}(+${extra.join(',') || '-'}/-${lack.join(',') || '-'})`);
    }
  }

  return { contaminated, missing, colDrift };
}

export interface ConstraintRow {
  table_name: string;
  /** 'p' = PRIMARY KEY, 'u' = UNIQUE。 */
  kind: string;
  /** 制約対象列を attname 昇順でカンマ連結した文字列（例: "review_id,user_id"）。 */
  columns: string;
}

export interface ConstraintDriftResult {
  /** 本番に在るが期待に無い制約（= out-of-band 追加の疑い）。 */
  extra: string[];
  /** 期待に在るが本番に無い制約（= 削除 / migration 未適用の疑い）。 */
  missing: string[];
}

/** 制約行を安定キー `table:kind(cols)` へ正規化する（順序非依存の集合比較用）。 */
function constraintKey(r: ConstraintRow): string {
  return `${r.table_name}:${r.kind}(${r.columns})`;
}

/**
 * 期待制約スナップショット（schema-constraints-snapshot.json）と
 * 本番制約（RPC get_public_constraints の結果）を突合し、PK/UNIQUE の
 * out-of-band 追加（extra）/ 欠落（missing）を返す。
 *
 * テーブルレベルの computeDrift と同じく、PostGIS システム/バックアップ系は監視対象外。
 */
export function computeConstraintDrift(
  expected: ConstraintRow[],
  prod: ConstraintRow[],
): ConstraintDriftResult {
  const expSet = new Set<string>();
  for (const r of expected) {
    if (isIgnored(r.table_name)) continue;
    expSet.add(constraintKey(r));
  }
  const prodSet = new Set<string>();
  for (const r of prod) {
    if (isIgnored(r.table_name)) continue;
    prodSet.add(constraintKey(r));
  }

  const extra = [...prodSet].filter((k) => !expSet.has(k)).sort();
  const missing = [...expSet].filter((k) => !prodSet.has(k)).sort();
  return { extra, missing };
}
