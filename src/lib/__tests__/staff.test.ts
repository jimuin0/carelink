const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getStaffByFacility, getStaffBySlug, getStaffPhotos, getMenuStaffByMenuIds } from '../staff';

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

// getMenuStaffByMenuIds は select('*').in('menu_id', ...) を直接 await する（.order/.single なし）。
// 終端の .in が Promise を返すチェーンを組む。
function menuStaffFluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  self.select = jest.fn(() => self);
  self.in = jest.fn(() => Promise.resolve(resolvedValue));
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

describe('getStaffByFacility — deep tests', () => {
  test('sort_order で order が呼ばれる', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getStaffByFacility('fac-1');
    expect(chain.order).toHaveBeenCalledWith('sort_order');
  });

  test('staff_profiles テーブルが使われる', async () => {
    mockFrom.mockReturnValue(fluent({ data: [] }));
    await getStaffByFacility('fac-1');
    expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
  });

  test('is_active=true フィルターが適用される', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getStaffByFacility('fac-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('複数スタッフが配列で返る', async () => {
    const staff = [
      { id: 's-1', staff_name: '田中' },
      { id: 's-2', staff_name: '佐藤' },
      { id: 's-3', staff_name: '鈴木' },
    ];
    mockFrom.mockReturnValue(fluent({ data: staff }));
    const result = await getStaffByFacility('fac-1');
    expect(result).toHaveLength(3);
  });
});

describe('getStaffBySlug — deep tests', () => {
  test('facility_id フィルターが適用される', async () => {
    const chain = fluent({ data: null });
    mockFrom.mockReturnValue(chain);
    await getStaffBySlug('fac-xyz', 'slug-1');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'fac-xyz');
  });

  test('is_active=true フィルターが適用される', async () => {
    const chain = fluent({ data: null });
    mockFrom.mockReturnValue(chain);
    await getStaffBySlug('fac-1', 'slug-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('slug が一致するスタッフを返す', async () => {
    const staff = { id: 's-2', staff_name: '佐藤', slug: 'sato' };
    mockFrom.mockReturnValue(fluent({ data: staff }));
    const result = await getStaffBySlug('fac-1', 'sato');
    expect(result?.slug).toBe('sato');
  });
});

describe('getMenuStaffByMenuIds（担当メニュー行取得・2026年7月15日）', () => {
  test('menuIds が空配列 → 問い合わせせず [] を返す（早期return）', async () => {
    const result = await getMenuStaffByMenuIds([]);
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('menuIds が非空 → menu_staff を menu_id で in 絞込して行を返す', async () => {
    const rows = [{ id: 'ms-1', menu_id: 'm-1', staff_id: 's-1' }];
    const chain = menuStaffFluent({ data: rows });
    mockFrom.mockReturnValue(chain);

    const result = await getMenuStaffByMenuIds(['m-1', 'm-2']);
    expect(result).toEqual(rows);
    expect(mockFrom).toHaveBeenCalledWith('menu_staff');
    expect(chain.in).toHaveBeenCalledWith('menu_id', ['m-1', 'm-2']);
  });

  test('data が null → 空配列（?? [] フォールバック）', async () => {
    mockFrom.mockReturnValue(menuStaffFluent({ data: null }));
    const result = await getMenuStaffByMenuIds(['m-1']);
    expect(result).toEqual([]);
  });
});

describe('getStaffPhotos — deep tests', () => {
  test('staff_photos テーブルが使われる', async () => {
    mockFrom.mockReturnValue(fluent({ data: [] }));
    await getStaffPhotos('s-1');
    expect(mockFrom).toHaveBeenCalledWith('staff_photos');
  });

  test('staff_id フィルターが適用される', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getStaffPhotos('s-abc');
    expect(chain.eq).toHaveBeenCalledWith('staff_id', 's-abc');
  });

  test('sort_order で order が呼ばれる', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getStaffPhotos('s-1');
    expect(chain.order).toHaveBeenCalledWith('sort_order');
  });

  test('複数写真が配列で返る', async () => {
    const photos = [
      { id: 'p-1', url: 'https://cdn.example.com/1.jpg' },
      { id: 'p-2', url: 'https://cdn.example.com/2.jpg' },
    ];
    mockFrom.mockReturnValue(fluent({ data: photos }));
    const result = await getStaffPhotos('s-1');
    expect(result).toHaveLength(2);
  });
});
