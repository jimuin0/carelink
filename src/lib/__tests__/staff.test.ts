const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getStaffByFacility, getStaffBySlug, getStaffPhotos } from '../staff';

beforeEach(() => {
  mockFrom.mockReset();
});

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.order = jest.fn(() => Promise.resolve(resolvedValue));
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('getStaffByFacility', () => {
  test('アクティブなスタッフ一覧を返す', async () => {
    const staff = [{ id: 's-1', staff_name: '田中' }, { id: 's-2', staff_name: '佐藤' }];
    const chain = fluent({ data: staff });
    mockFrom.mockReturnValue(chain);

    const result = await getStaffByFacility('fac-1');
    expect(result).toEqual(staff);
    expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'fac-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('データがない場合は空配列', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getStaffByFacility('fac-1');
    expect(result).toEqual([]);
  });
});

describe('getStaffBySlug', () => {
  test('スタッフを返す', async () => {
    const staff = { id: 's-1', staff_name: '田中', slug: 'tanaka' };
    const chain = fluent({ data: staff });
    mockFrom.mockReturnValue(chain);

    const result = await getStaffBySlug('fac-1', 'tanaka');
    expect(result).toEqual(staff);
    expect(chain.eq).toHaveBeenCalledWith('slug', 'tanaka');
  });

  test('存在しない場合はnull', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getStaffBySlug('fac-1', 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('getStaffPhotos', () => {
  test('写真一覧を返す', async () => {
    const photos = [{ id: 'p-1', url: 'https://example.com/1.jpg' }];
    mockFrom.mockReturnValue(fluent({ data: photos }));

    const result = await getStaffPhotos('s-1');
    expect(result).toEqual(photos);
    expect(mockFrom).toHaveBeenCalledWith('staff_photos');
  });

  test('データがない場合は空配列', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getStaffPhotos('s-1');
    expect(result).toEqual([]);
  });
});
