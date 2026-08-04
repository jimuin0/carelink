/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/schema-drift.ts (computeDrift / isIgnored) — branches 100%。
 */
import {
  computeDrift,
  diffFingerprint,
  isIgnored,
  VERSION_LINE_PREFIX,
} from '../schema-drift';

describe('isIgnored', () => {
  test('PostGIS システムは対象外', () => {
    expect(isIgnored('spatial_ref_sys')).toBe(true);
    expect(isIgnored('geography_columns')).toBe(true);
  });
  test('_backup_ 接頭辞は対象外', () => {
    expect(isIgnored('_backup_facility_members_20260612')).toBe(true);
  });
  test('通常テーブルは対象', () => {
    expect(isIgnored('bookings')).toBe(false);
  });
});

describe('computeDrift', () => {
  test('混入・欠落・列差分(extra/lack)・一致・対象外 を正しく分類', () => {
    const expected = {
      keep: ['a', 'b'],
      missing_tbl: ['x'],
      coldrift_extra: ['a'],
      coldrift_lack: ['a', 'b'],
      spatial_ref_sys: ['srid'], // 対象外(names ループで skip)
    };
    const rows = [
      { table_name: 'keep', column_name: 'a' },
      { table_name: 'keep', column_name: 'b' }, // 2行目=既存setを引く
      { table_name: 'coldrift_extra', column_name: 'a' },
      { table_name: 'coldrift_extra', column_name: 'b' }, // extra=b
      { table_name: 'coldrift_lack', column_name: 'a' }, // lack=b
      { table_name: 'contam_tbl', column_name: 'z' }, // 期待に無い=混入
      { table_name: 'spatial_ref_sys', column_name: 'srid' }, // rows ループで skip
      { table_name: '_backup_x', column_name: 'c' }, // rows ループで skip(接頭辞)
    ];
    const r = computeDrift(expected, rows);
    expect(r.contaminated).toEqual(['contam_tbl']);
    expect(r.missing).toEqual(['missing_tbl']);
    expect(r.colDrift).toEqual([
      'coldrift_extra(+b/--)',
      'coldrift_lack(+-/-b)',
    ]);
  });

  test('完全一致ならドリフトなし', () => {
    const r = computeDrift({ t: ['a'] }, [{ table_name: 't', column_name: 'a' }]);
    expect(r).toEqual({ contaminated: [], missing: [], colDrift: [] });
  });
});


describe('diffFingerprint', () => {
  /** 空振り判定(VACUOUS_MIN_ITEMS=500)を超える件数のダミーを作る。 */
  const bulk = (n: number, prefix = 'x') =>
    Array.from({ length: n }, (_, i) => `${prefix}|item${i}`);

  it('完全一致なら extra/missing とも空', () => {
    const a = bulk(600);
    expect(diffFingerprint(a, [...a])).toEqual({ extra: [], missing: [], vacuous: false });
  });

  it('順序が違っても一致とみなす（集合比較）', () => {
    const a = bulk(600);
    expect(diffFingerprint(a, [...a].reverse()).missing).toEqual([]);
  });

  it('本番に無い項目は missing（migration 未適用 / out-of-band 削除）', () => {
    const a = bulk(600);
    const b = a.filter((l) => l !== 'x|item42');
    expect(diffFingerprint(a, b)).toEqual({ extra: [], missing: ['x|item42'], vacuous: false });
  });

  it('本番にだけ在る項目は extra（out-of-band 追加）', () => {
    const a = bulk(600);
    expect(diffFingerprint(a, [...a, 'x|leaked'])).toEqual({
      extra: ['x|leaked'],
      missing: [],
      vacuous: false,
    });
  });

  it('空白のみ/空文字の行は無視する（psql 出力の末尾改行で誤検知しない）', () => {
    const a = bulk(600);
    expect(diffFingerprint(a, [...a, '', '   ']).extra).toEqual([]);
  });

  it('🔴 どちらかが 500 未満なら vacuous=true（0件同士の一致を緑にしない）', () => {
    const a = bulk(600);
    expect(diffFingerprint([], []).vacuous).toBe(true);
    expect(diffFingerprint(a, []).vacuous).toBe(true);
    expect(diffFingerprint([], a).vacuous).toBe(true);
  });

  it('vacuous のとき extra/missing は空にして、差分を主張しない', () => {
    // 「測れていない」を「差分がある/ない」のどちらとしても報告しない。
    expect(diffFingerprint(bulk(10), bulk(10, 'y'))).toEqual({
      extra: [],
      missing: [],
      vacuous: true,
    });
  });

  it('境界: ちょうど 500 件なら vacuous ではない', () => {
    const a = bulk(500);
    expect(diffFingerprint(a, [...a]).vacuous).toBe(false);
    expect(diffFingerprint(bulk(499), bulk(499)).vacuous).toBe(true);
  });

  it('null/undefined を渡されても落ちない（RPC が想定外を返しても監視を殺さない）', () => {
    expect(
      diffFingerprint(undefined as unknown as string[], undefined as unknown as string[]).vacuous,
    ).toBe(true);
  });

  it('配列の要素が null/undefined でも落ちない（jsonb 配列に null が混じる場合）', () => {
    // RPC は jsonb_agg で作るため、理論上 null 要素が混じり得る。
    // ここで例外が出ると監視そのものが停止する（＝無音で死ぬ）ので、必ず握れること。
    const a = bulk(600);
    const withNulls = [...a, null, undefined] as unknown as string[];
    expect(diffFingerprint(a, withNulls)).toEqual({ extra: [], missing: [], vacuous: false });
    expect(diffFingerprint(withNulls, a)).toEqual({ extra: [], missing: [], vacuous: false });
  });
});

describe('diffFingerprint: 別 DB と突合していないかの判定', () => {
  /** 期待/実測を「リレーション名の集合」から組み立てる（VACUOUS 下限も満たす量にする）。 */
  const build = (rels: string[], pad: string) => [
    ...rels.map((r) => `relation|${r}|r|rls=t|force=f`),
    ...Array.from({ length: 600 }, (_, i) => `column|${pad}${i}.c|text|notnull=f|default=|generated=`),
  ];

  it('同じ DB（テーブル名が一致）なら通常どおり差分を出す', () => {
    const rels = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const r = diffFingerprint(build(rels, 'a'), build(rels, 'a'));
    expect(r.differentDatabase).toBeUndefined();
    expect(r.missing).toEqual([]);
  });

  it('🔴 別 DB（テーブル名が全く違う）なら差分を 1 件も主張しない', () => {
    // 2026年8月2日に実際にやりかけた事故: CareLink の期待値を soel の本番と突合し、
    // 「RLS 90 本欠落」という存在しない事故を報告しかけた。
    const expRels = Array.from({ length: 20 }, (_, i) => `carelink_t${i}`);
    const actRels = Array.from({ length: 20 }, (_, i) => `soel_t${i}`);
    const r = diffFingerprint(build(expRels, 'a'), build(actRels, 'b'));
    expect(r.differentDatabase).toBeDefined();
    expect(r.differentDatabase?.overlap).toBe(0);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('一部のテーブルが未適用でも（重なりが高ければ）別 DB とは判定しない', () => {
    // migration 未適用で本番のテーブルが少ない状況は「同じ DB」。ここを別 DB 扱いすると
    // 本物の未適用検知が丸ごと死ぬ。
    const expRels = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const actRels = expRels.slice(0, 14); // 30% 欠けている
    const r = diffFingerprint(build(expRels, 'a'), build(actRels, 'a'));
    expect(r.differentDatabase).toBeUndefined();
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('境界: 重なりちょうど 50% は別 DB としない / 下回ると別 DB', () => {
    const expRels = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const half = [...expRels.slice(0, 10), ...Array.from({ length: 10 }, (_, i) => `x${i}`)];
    expect(diffFingerprint(build(expRels, 'a'), build(half, 'a')).differentDatabase).toBeUndefined();
    const below = [...expRels.slice(0, 9), ...Array.from({ length: 11 }, (_, i) => `x${i}`)];
    expect(diffFingerprint(build(expRels, 'a'), build(below, 'a')).differentDatabase).toBeDefined();
  });

  it('空振り(vacuous)の判定が別 DB 判定より先に効く', () => {
    // どちらも「差分を主張しない」が、原因の説明が違う。取り違えると調査が空回りする。
    const r = diffFingerprint(['relation|a|r|rls=t|force=f'], ['relation|z|r|rls=t|force=f']);
    expect(r.vacuous).toBe(true);
    expect(r.differentDatabase).toBeUndefined();
  });
});

describe('diffFingerprint: PostgreSQL メジャーバージョンの一致判定', () => {
  /** 期待/実測を「バージョン行 + 十分な件数」で組み立てる。 */
  const build = (major: string | null) => [
    ...(major === null ? [] : [`${VERSION_LINE_PREFIX}${major}`]),
    ...Array.from({ length: 20 }, (_, i) => `relation|t${i}|r|rls=t|force=f`),
    ...Array.from({ length: 600 }, (_, i) => `column|t.c${i}|text|notnull=f|default=|generated=`),
  ];

  it('メジャーが一致していれば通常どおり差分を出す', () => {
    const r = diffFingerprint(build('17'), [...build('17'), 'index|t|leaked|CREATE INDEX']);
    expect(r.versionMismatch).toBeUndefined();
    expect(r.extra).toEqual(['index|t|leaked|CREATE INDEX']);
  });

  it('🔴 メジャーが違えば差分を 1 件も主張しない（整形差のノイズを事故として報告しない）', () => {
    // pg_get_constraintdef / pg_get_indexdef / format_type の整形はメジャー間で変わり得る。
    // その差を missing/extra として出すと「存在しないドリフト」の報告になる。
    const r = diffFingerprint(build('17'), [...build('16'), 'index|t|leaked|CREATE INDEX']);
    expect(r.versionMismatch).toEqual({ expected: '17', actual: '16' });
    expect(r.extra).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.vacuous).toBe(false);
  });

  it('🔴 片側にバージョン行が無い場合も不一致として扱う（本番 RPC が古い＝突合が成立していない）', () => {
    expect(diffFingerprint(build('17'), build(null)).versionMismatch).toEqual({
      expected: '17',
      actual: null,
    });
    expect(diffFingerprint(build(null), build('17')).versionMismatch).toEqual({
      expected: null,
      actual: '17',
    });
  });

  it('両側ともバージョン行が無ければ、この判定は何も主張しない（旧 RPC 同士の比較を殺さない）', () => {
    const r = diffFingerprint(build(null), build(null));
    expect(r.versionMismatch).toBeUndefined();
    expect(r.missing).toEqual([]);
  });

  it('🔴 マイナー(パッチ)は比較対象に入らない — 同一メジャーなら差分ゼロ', () => {
    // 2026年8月3日に直した欠陥の再発防止。server_version_num をそのまま入れていた頃は
    // Supabase のマイナー更新や postgis イメージの再 pull だけで、スキーマが 1 文字も
    // 変わらないのに必ず鳴った（誤報の確定装置）。
    expect(diffFingerprint(build('17'), build('17'))).toEqual({
      extra: [],
      missing: [],
      vacuous: false,
    });
  });

  it('別 DB 判定がバージョン判定より先に効く（原因の説明を取り違えない）', () => {
    const exp = [
      `${VERSION_LINE_PREFIX}17`,
      ...Array.from({ length: 20 }, (_, i) => `relation|carelink_t${i}|r|rls=t|force=f`),
      ...Array.from({ length: 600 }, (_, i) => `column|a${i}.c|text|notnull=f|default=|generated=`),
    ];
    const act = [
      `${VERSION_LINE_PREFIX}16`,
      ...Array.from({ length: 20 }, (_, i) => `relation|soel_t${i}|r|rls=t|force=f`),
      ...Array.from({ length: 600 }, (_, i) => `column|b${i}.c|text|notnull=f|default=|generated=`),
    ];
    const r = diffFingerprint(exp, act);
    expect(r.differentDatabase).toBeDefined();
    expect(r.versionMismatch).toBeUndefined();
  });

  it('空振り(vacuous)がバージョン判定より先に効く', () => {
    const r = diffFingerprint([`${VERSION_LINE_PREFIX}17`], [`${VERSION_LINE_PREFIX}16`]);
    expect(r.vacuous).toBe(true);
    expect(r.versionMismatch).toBeUndefined();
  });

  it('バージョン行が重複しても決定的に振る舞う（Set の反復順に依存しない）', () => {
    // 昇順で最初の値を採るので、入力の並びが変わっても結果は変わらない。
    const dup = [`${VERSION_LINE_PREFIX}9`, ...build('17')];
    const reversed = [...dup].reverse();
    expect(diffFingerprint(build('9'), dup).versionMismatch).toEqual({
      expected: '9',
      actual: '17',
    });
    expect(diffFingerprint(build('9'), reversed).versionMismatch).toEqual({
      expected: '9',
      actual: '17',
    });
  });
});
