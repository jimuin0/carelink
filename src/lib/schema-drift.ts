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
  /**
   * 🔴 別の DB と突合している疑い。set されているとき extra/missing は空で、
   * 差分を 1 件も主張しない（数千件の「差分」は本番の異常ではなく比較対象の誤り）。
   */
  differentDatabase?: {
    overlap: number;
    sharedRelations: number;
    expectedRelations: number;
    actualRelations: number;
  };
  /**
   * 🔴 shadow と本番の PostgreSQL メジャーバージョンが違う。set されているとき
   * extra/missing は空で、差分を 1 件も主張しない（pg_get_* の整形がメジャー間で
   * 変わり得るため、出てくる差分は「本番のドリフト」ではなく整形差のノイズ）。
   */
  versionMismatch?: {
    expected: string | null;
    actual: string | null;
  };
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

/**
 * 「同じ DB を見ているか」の判定しきい値（リレーション名の重なり率）。
 *
 * 🔴 なぜ要るか（2026年8月2日・実際にやりかけた事故）:
 *   検証中、CareLink の期待値を **soel の本番 DB** と突合してしまい、
 *   「RLS ポリシーが 90 本欠落」という**存在しない重大事故を報告しかけた**。
 *   別 DB と突合すれば差分は数千件出るが、それは「本番が壊れている」ではなく
 *   「比較対象を間違えている」。この 2 つを取り違えるのが最悪の誤報。
 *
 *   人の注意（「プロジェクトを確認すること」）では止まらなかった。実際に止まらなかった。
 *   リレーション名の重なりが極端に低ければ **別の DB と判定**し、差分を 1 件も主張しない。
 *
 *   0.5 の根拠: 同一 DB なら未適用 migration があっても大半のテーブル名は共通する。
 *   別プロダクトなら重なりはほぼ 0（soel と CareLink は共通テーブルが 1 件も無く 0.0）。
 *   中間の値が出る状況は設計上考えにくいので、しきい値の精密さは問題にならない。
 */
export const SAME_DATABASE_MIN_OVERLAP = 0.5;

/** フィンガープリント内の PostgreSQL メジャーバージョン行の接頭辞。 */
export const VERSION_LINE_PREFIX = 'meta|server_version_major|';

/**
 * `meta|server_version_major|<n>` から値を取り出す。行が無ければ null。
 *
 * null は「取れなかった」であって「一致」ではない。片側だけ null なら
 * versionMismatch として扱う（本番 RPC が古い＝比較が成立していない状態を、
 * missing 行に埋もれさせずに 1 件の明確な事象として出すため）。
 */
function versionMajor(lines: Set<string>): string | null {
  const hits: string[] = [];
  for (const l of lines) {
    if (l.startsWith(VERSION_LINE_PREFIX)) hits.push(l.slice(VERSION_LINE_PREFIX.length));
  }
  hits.sort();
  return hits.length > 0 ? hits[0] : null;
}

/** `relation|<name>|...` からリレーション名だけを取り出す。 */
function relationNames(lines: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (!l.startsWith('relation|')) continue;
    // `?? ''` は書かない。'relation|' で始まる行の split('|')[1] は必ず string
    // （区切りが在る以上 undefined にならない。'relation|' 単体でも '' が返る）で、
    // 到達しない分岐を作るだけになる。空文字は下の delete がまとめて落とす。
    out.add(l.split('|')[1]);
  }
  out.delete('');
  return out;
}

export function diffFingerprint(expected: string[], actual: string[]): FingerprintDiffResult {
  const norm = (arr: string[]) =>
    new Set((arr ?? []).map((l) => (l ?? '').trim()).filter(Boolean));
  const exp = norm(expected);
  const act = norm(actual);

  if (exp.size < VACUOUS_MIN_ITEMS || act.size < VACUOUS_MIN_ITEMS) {
    return { extra: [], missing: [], vacuous: true };
  }

  // 🔴 差分を数える【前に】「同じ DB か」を判定する。順序が本質。
  //   別 DB の差分を missing/extra として報告すると、存在しない事故の報告になる。
  const expRels = relationNames(exp);
  const actRels = relationNames(act);
  const denom = Math.min(expRels.size, actRels.size);
  if (denom > 0) {
    let shared = 0;
    for (const r of actRels) if (expRels.has(r)) shared += 1;
    const overlap = shared / denom;
    if (overlap < SAME_DATABASE_MIN_OVERLAP) {
      return {
        extra: [],
        missing: [],
        vacuous: false,
        differentDatabase: {
          overlap,
          sharedRelations: shared,
          expectedRelations: expRels.size,
          actualRelations: actRels.size,
        },
      };
    }
  }

  // 🔴 差分を数える【前に】メジャーバージョンの一致を確認する（differentDatabase と同じ理屈）。
  //   メジャーが違えば pg_get_constraintdef / pg_get_indexdef / format_type の整形が
  //   変わり得るため、出てくる差分は「本番のドリフト」ではなく整形差のノイズになる。
  //   数百件のノイズを missing/extra として報告するのは、存在しない事故の報告と同じ。
  const expVer = versionMajor(exp);
  const actVer = versionMajor(act);
  if (expVer !== actVer) {
    return {
      extra: [],
      missing: [],
      vacuous: false,
      versionMismatch: { expected: expVer, actual: actVer },
    };
  }

  const missing = [...exp].filter((l) => !act.has(l)).sort();
  const extra = [...act].filter((l) => !exp.has(l)).sort();
  return { extra, missing, vacuous: false };
}
