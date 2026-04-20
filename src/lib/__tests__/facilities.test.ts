const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (fn: unknown) => fn,
}));

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import {
  searchFacilities,
  getPopularFacilities,
  getFacilityBySlug,
  getFacilityMenus,
  getFacilityPhotos,
  getFacilityReviews,
  getLatestFacilities,
  getSimilarFacilities,
  getMonthlyBookingCounts,
} from '../facilities';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

/** Build a fluent chain; every method returns self, terminal resolves with given value */
function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.neq = handler;
  self.or = handler;
  self.gte = handler;
  self.lte = handler;
  self.lt = handler;
  self.gt = handler;
  self.in = handler;
  self.contains = handler;
  self.order = handler;
  self.range = jest.fn(() => Promise.resolve(resolvedValue));
  self.limit = jest.fn(() => Promise.resolve(resolvedValue));
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('searchFacilities', () => {
  test('キーワード検索でorフィルタを使う', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ keyword: 'テスト' });
    expect(chain.or).toHaveBeenCalled();
    const call = (chain.or as jest.Mock).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('テスト')
    );
    expect(call).toBeTruthy();
  });

  test('business_typeフィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ type: 'ヘアサロン' });
    expect(chain.eq).toHaveBeenCalledWith('business_type', 'ヘアサロン');
  });

  test('都道府県フィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ prefecture: '東京都' });
    expect(chain.eq).toHaveBeenCalledWith('prefecture', '東京都');
  });

  test('価格フィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ price_min: 3000, price_max: 10000 });
    expect(chain.gte).toHaveBeenCalledWith('min_price', 3000);
    expect(chain.lte).toHaveBeenCalledWith('max_price', 10000);
  });

  test('featuresフィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ features: ['駐車場あり', '個室あり'] });
    expect(chain.contains).toHaveBeenCalledWith('features', ['駐車場あり']);
    expect(chain.contains).toHaveBeenCalledWith('features', ['個室あり']);
  });

  test('ページネーション（page=2）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);

    await searchFacilities({ page: 2 });
    expect(chain.range).toHaveBeenCalledWith(20, 39);
  });

  test('geo検索でRPC search_facilities_nearbyを呼ぶ', async () => {
    const nearbyFacilities = [
      { id: 'f-1', distance_km: 0.5 },
      { id: 'f-2', distance_km: 3.2 },
    ];
    // searchFacilities calls from() first to build a query, then rpc() for geo path
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: nearbyFacilities, error: null });

    const result = await searchFacilities({ lat: 35.6812, lng: 139.7671 });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      user_lat: 35.6812,
      user_lng: 139.7671,
      radius_km: 10,
    }));
    expect(result.facilities).toHaveLength(2);
  });
});

describe('getPopularFacilities', () => {
  test('人気施設を返す', async () => {
    const facilities = [{ id: 'f-1', name: 'テスト' }];
    const chain = fluent({ data: facilities, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getPopularFacilities(6);
    expect(result.facilities).toEqual(facilities);
  });
});

describe('getFacilityBySlug', () => {
  test('施設を返す', async () => {
    const facility = { id: 'f-1', slug: 'test-salon', name: 'テストサロン' };
    const chain = fluent({ data: facility, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityBySlug('test-salon');
    expect(result.facility).toEqual(facility);
    expect(chain.eq).toHaveBeenCalledWith('slug', 'test-salon');
  });

  test('存在しない場合はnull', async () => {
    mockFrom.mockReturnValue(fluent({ data: null, error: null }));

    const result = await getFacilityBySlug('nonexistent');
    expect(result.facility).toBeNull();
  });
});

describe('getFacilityMenus', () => {
  test('メニュー一覧を返す', async () => {
    const menus = [{ id: 'm-1', name: 'カット' }];
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: menus, error: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityMenus('fac-1');
    expect(result.menus).toEqual(menus);
    expect(mockFrom).toHaveBeenCalledWith('facility_menus');
  });
});

describe('getFacilityPhotos', () => {
  test('写真一覧を返す', async () => {
    const photos = [{ id: 'p-1', url: 'https://example.com/1.jpg' }];
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: photos, error: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityPhotos('fac-1');
    expect(result.photos).toEqual(photos);
    expect(mockFrom).toHaveBeenCalledWith('facility_photos');
  });
});

describe('getFacilityReviews', () => {
  test('口コミ一覧を返す', async () => {
    const reviews = [{ id: 'r-1', rating: 5 }];
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: reviews, error: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityReviews('fac-1');
    expect(result.reviews).toEqual(reviews);
    expect(chain.eq).toHaveBeenCalledWith('status', 'published');
  });
});

describe('getLatestFacilities', () => {
  test('最新施設を返す', async () => {
    const facilities = [{ id: 'f-1' }];
    const chain = fluent({ data: facilities, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getLatestFacilities(6);
    expect(result.facilities).toEqual(facilities);
  });
});

describe('getSimilarFacilities', () => {
  test('同業種・同地域の施設を返す（自身を除く）', async () => {
    const facilities = [{ id: 'f-2' }];
    const chain = fluent({ data: facilities });
    mockFrom.mockReturnValue(chain);

    const result = await getSimilarFacilities('f-1', 'ヘアサロン', '東京都');
    expect(result).toEqual(facilities);
    expect(chain.neq).toHaveBeenCalledWith('id', 'f-1');
    expect(chain.eq).toHaveBeenCalledWith('business_type', 'ヘアサロン');
  });
});

describe('getMonthlyBookingCounts', () => {
  test('施設ごとの当月予約数を返す', async () => {
    const bookings = [
      { facility_id: 'f-1' },
      { facility_id: 'f-1' },
      { facility_id: 'f-2' },
    ];
    const chain = fluent(null);
    chain.lt = jest.fn(() => Promise.resolve({ data: bookings }));
    mockFrom.mockReturnValue(chain);

    const result = await getMonthlyBookingCounts(['f-1', 'f-2']);
    expect(result).toEqual({ 'f-1': 2, 'f-2': 1 });
  });

  test('空配列の場合は空オブジェクト', async () => {
    const result = await getMonthlyBookingCounts([]);
    expect(result).toEqual({});
  });
});
