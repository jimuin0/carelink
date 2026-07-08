/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/register-complete.ts
 * - id が実在する salons レコードの場合のみ実データを返す
 * - id 未指定・不正形式（非UUID）・DB に存在しない場合は空サマリー（偽装表示不可）
 */

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

import { resolveRegisteredSalon } from '../register-complete';

const VALID_ID = '11111111-2222-3333-4444-555555555555';

describe('resolveRegisteredSalon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns real DB data when id exists in salons', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { facility_name: '本物の施設名', business_type: '訪問介護', address: '東京都渋谷区' },
    });

    const result = await resolveRegisteredSalon(VALID_ID);

    expect(result).toEqual({ name: '本物の施設名', type: '訪問介護', area: '東京都渋谷区' });
    expect(mockFrom).toHaveBeenCalledWith('salons');
    expect(mockEq).toHaveBeenCalledWith('id', VALID_ID);
  });

  it('returns empty summary when id has no matching row (spoofed id cannot show fake data)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    const result = await resolveRegisteredSalon(VALID_ID);

    expect(result).toEqual({ name: '', type: '', area: '' });
  });

  it('coerces null DB columns to empty strings (address 等が NULL の実レコードでもクラッシュしない)', async () => {
    // address は salons スキーマ上 nullable。facility_name/business_type も
    // 将来的な NULL 混入に備え、null を '' にフォールバックする分岐を検証する。
    mockMaybeSingle.mockResolvedValue({
      data: { facility_name: null, business_type: null, address: null },
    });

    const result = await resolveRegisteredSalon(VALID_ID);

    expect(result).toEqual({ name: '', type: '', area: '' });
  });

  it('returns empty summary without querying DB when id is undefined', async () => {
    const result = await resolveRegisteredSalon(undefined);

    expect(result).toEqual({ name: '', type: '', area: '' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns empty summary without querying DB when id is not a valid UUID (rejects injected/arbitrary strings)', async () => {
    const result = await resolveRegisteredSalon('<script>alert(1)</script>');

    expect(result).toEqual({ name: '', type: '', area: '' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
