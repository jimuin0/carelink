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

/** フィンガープリント突合の結果。 */
export interface FingerprintDiffResult {
  /** 本番にあるが migration に無い（out-of-band 追加）。 */
  extra: string[];
  /** migration にはあるが本番に無い（未適用 / out-of-band 削除）。 */
  missing: string[];
  /** 走査が空振り（どちらかが極端に少ない）。true のとき extra/missing は信用しない。 */
  vacuous: boolean;
}

/**
 * 期待フィンガープリント（migration を使い捨て Postgres に全適用して生成）と
 * 本番フィンガープリント（RPC get_schema_fingerprint）を突合する。
 *
 * 🔴 なぜ手管理スナップショットをやめたか（2026年8月2日 実測）:
 *   期待値を人が更新する方式は、migration が制約を変えた瞬間に取り残されて誤報になる。
 *   実際 UNIQUE(facility_id,is_active) の意図的な DROP で毎日鳴り続けていた。
 *   期待値を migration から毎回導出すれば、この class は構造的に消える。
 *
 * 空振り判定: 期待側・実測側のどちらかが VACUOUS_MIN_ITEMS 未満なら vacuous=true。
 *   0 件同士の「一致」を緑と読み替えさせないため（監視が死んでいるのと区別できない）。
 */
export const VACUOUS_MIN_ITEMS = 500;

export function diffFingerprint(expected: string[], actual: string[]): FingerprintDiffResult {
  const norm = (arr: string[]) =>
    new Set((arr ?? []).map((l) => (l ?? '').trim()).filter(Boolean));
  const exp = norm(expected);
  const act = norm(actual);

  if (exp.size < VACUOUS_MIN_ITEMS || act.size < VACUOUS_MIN_ITEMS) {
    return { extra: [], missing: [], vacuous: true };
  }

  const missing = [...exp].filter((l) => !act.has(l)).sort();
  const extra = [...act].filter((l) => !exp.has(l)).sort();
  return { extra, missing, vacuous: false };
}
