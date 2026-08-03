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

describe('schema-constraints-snapshot.json（期待スナップショットの正しさ）', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const snapshot = require('../schema-constraints-snapshot.json') as Array<{
    table_name: string;
    kind: string;
    columns: string;
  }>;

  test('意図的に撤去した intake_form_templates の UNIQUE(facility_id,is_active) を含まない', () => {
    // 【2026年8月3日 恒久修正】この複合 UNIQUE は
    // supabase/migrations/20260722000005_intake_active_partial_unique.sql で
    // 意図的に DROP し、部分ユニークインデックス
    // uq_intake_active_per_facility (facility_id) WHERE is_active に置換した
    // （複合 UNIQUE は「非アクティブも施設あたり1件まで」になる設計欠陥だった）。
    //
    // ところが期待スナップショット側を更新し忘れたため、schema-drift-check が
    // 毎回「制約欠落1」を Slack へ警報し続けていた（実例: 2026-08-03 02:40 の
    // WARNING）。本番 DB は正しく、監視側だけが古い＝典型的な誤報である。
    //
    // 誤報は「またあの警告か」を生み、本物のドリフトを埋もれさせるため、
    // スナップショットからの除去を回帰テストで固定する。
    //
    // なお置換先は UNIQUE INDEX であって pg_constraint の行を作らない
    // （Postgres は部分ユニークを constraint として表現できない）。
    // get_public_constraints RPC は pg_constraint のみを読むため、
    // 代わりのエントリを足すことはできない＝削除が正しい対処。
    const stale = snapshot.filter(
      (r) =>
        r.table_name === 'intake_form_templates' &&
        r.kind === 'u' &&
        r.columns === 'facility_id,is_active',
    );
    expect(stale).toEqual([]);
  });

  test('intake_form_templates の主キーは維持されている（過剰削除の防止）', () => {
    const pk = snapshot.filter(
      (r) => r.table_name === 'intake_form_templates' && r.kind === 'p',
    );
    expect(pk).toEqual([
      { table_name: 'intake_form_templates', kind: 'p', columns: 'id' },
    ]);
  });
});
