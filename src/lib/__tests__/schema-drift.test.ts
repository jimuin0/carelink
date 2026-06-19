/**
 * @jest-environment node
 *
 * Tests for lib/schema-drift.ts (computeDrift / isIgnored) — branches 100%。
 */
import { computeDrift, isIgnored } from '../schema-drift';

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
