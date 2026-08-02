/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/schema-drift.ts (computeDrift / isIgnored) — branches 100%。
 */
import { computeDrift, diffFingerprint, isIgnored } from '../schema-drift';

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
