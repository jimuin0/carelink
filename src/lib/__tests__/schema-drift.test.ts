/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/schema-drift.ts (computeDrift / isIgnored) — branches 100%。
 */
import { computeDrift, computeConstraintDrift, isIgnored } from '../schema-drift';

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

describe('computeConstraintDrift', () => {
  test('extra(本番先行)・missing(本番欠落)・一致・対象外 を正しく分類', () => {
    const expected = [
      { table_name: 'review_helpful', kind: 'p', columns: 'id' }, // 一致
      { table_name: 'review_helpful', kind: 'u', columns: 'review_id,user_id' }, // 一致
      { table_name: 'features', kind: 'u', columns: 'slug' }, // missing(本番に無い)
      { table_name: 'spatial_ref_sys', kind: 'p', columns: 'srid' }, // 対象外(expected ループで skip)
    ];
    const prod = [
      { table_name: 'review_helpful', kind: 'p', columns: 'id' }, // 一致
      { table_name: 'review_helpful', kind: 'u', columns: 'review_id,user_id' }, // 一致
      { table_name: 'coupon_redemptions', kind: 'p', columns: 'id' }, // extra(期待に無い)
      { table_name: 'spatial_ref_sys', kind: 'p', columns: 'srid' }, // 対象外(prod ループで skip)
    ];
    const r = computeConstraintDrift(expected, prod);
    expect(r.extra).toEqual(['coupon_redemptions:p(id)']);
    expect(r.missing).toEqual(['features:u(slug)']);
  });

  test('完全一致ならドリフトなし', () => {
    const rows = [{ table_name: 't', kind: 'p', columns: 'id' }];
    expect(computeConstraintDrift(rows, rows)).toEqual({ extra: [], missing: [] });
  });
});
