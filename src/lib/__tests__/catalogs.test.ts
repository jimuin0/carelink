const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getCatalogsByFacility } from '../catalogs';

beforeEach(() => {
  mockFrom.mockReset();
});

describe('getCatalogsByFacility', () => {
  const facilityId = 'fac-001';

  it('returns catalogs ordered by created_at desc', async () => {
    const mockCatalogs = [
      { id: 'c1', facility_id: facilityId, title: 'ヘア1', created_at: '2026-04-10' },
      { id: 'c2', facility_id: facilityId, title: 'ヘア2', created_at: '2026-04-09' },
    ];
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockCatalogs }),
    });

    const result = await getCatalogsByFacility(facilityId);
    expect(result).toEqual(mockCatalogs);
    expect(mockFrom).toHaveBeenCalledWith('treatment_catalogs');
  });

  it('returns empty array when no catalogs found', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null }),
    });

    const result = await getCatalogsByFacility(facilityId);
    expect(result).toEqual([]);
  });

  it('filters by facility_id', async () => {
    const eqMock = jest.fn().mockReturnThis();
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: eqMock,
      order: jest.fn().mockResolvedValue({ data: [] }),
    });

    await getCatalogsByFacility('specific-fac-id');
    expect(eqMock).toHaveBeenCalledWith('facility_id', 'specific-fac-id');
  });
});
