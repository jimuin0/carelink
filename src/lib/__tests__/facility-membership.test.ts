/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { getAdminFacilityIds, resolveTargetFacilityId } from '../facility-membership';

function makeSupabase(rows: unknown[] | null) {
  const inMock = jest.fn().mockResolvedValue({ data: rows });
  const eq = jest.fn(() => ({ in: inMock }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('getAdminFacilityIds', () => {
  test('owner/adminの施設IDを配列で返す', async () => {
    const supabase = makeSupabase([{ facility_id: 'fac-1' }, { facility_id: 'fac-2' }]);
    const result = await getAdminFacilityIds(supabase, 'user-1');
    expect(result).toEqual(['fac-1', 'fac-2']);
  });

  test('data が null なら空配列を返す', async () => {
    const supabase = makeSupabase(null);
    const result = await getAdminFacilityIds(supabase, 'user-1');
    expect(result).toEqual([]);
  });
});

describe('resolveTargetFacilityId', () => {
  test('所属ゼロ → none', () => {
    expect(resolveTargetFacilityId([], undefined)).toEqual({ facilityId: null, reason: 'none' });
  });

  test('単一施設・未指定 → 自動選択', () => {
    expect(resolveTargetFacilityId(['fac-1'], undefined)).toEqual({ facilityId: 'fac-1', reason: 'ok' });
  });

  test('複数施設・未指定 → ambiguous（要指定）', () => {
    expect(resolveTargetFacilityId(['fac-1', 'fac-2'], undefined)).toEqual({ facilityId: null, reason: 'ambiguous' });
  });

  test('指定あり・所属に含まれる → ok', () => {
    expect(resolveTargetFacilityId(['fac-1', 'fac-2'], 'fac-2')).toEqual({ facilityId: 'fac-2', reason: 'ok' });
  });

  test('指定あり・所属に含まれない → forbidden（越境防止）', () => {
    expect(resolveTargetFacilityId(['fac-1'], 'fac-999')).toEqual({ facilityId: null, reason: 'forbidden' });
  });

  test('指定が空文字 → 未指定扱い', () => {
    expect(resolveTargetFacilityId(['fac-1'], '')).toEqual({ facilityId: 'fac-1', reason: 'ok' });
  });

  test('指定が文字列でない（数値等） → 未指定扱い', () => {
    expect(resolveTargetFacilityId(['fac-1'], 123)).toEqual({ facilityId: 'fac-1', reason: 'ok' });
  });
});
