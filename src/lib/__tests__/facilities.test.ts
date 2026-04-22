const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (fn: unknown) => fn,
}));

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));
jest.mock('../redis', () => ({
  cachedFetch: jest.fn().mockImplementation((_key: string, fetcher: () => Promise<unknown>) => fetcher()),
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheDel: jest.fn().mockResolvedValue(undefined),
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
  getFeaturedFacilities,
  getNearbyFacilities,
  getAvailableFacilityIds,
} from '../facilities';

const { cachedFetch } = require('../redis');

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
    // status filter removed — public_reviews view already filters to published
    expect(mockFrom).toHaveBeenCalledWith('public_reviews');
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

// ─── searchFacilities (additional branches) ──────────────────────────────────

describe('searchFacilities (additional branches)', () => {
  test('cityフィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ city: '豊中市' });
    expect(chain.eq).toHaveBeenCalledWith('city', '豊中市');
  });

  test('rating_minフィルタ', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ rating_min: 4.0 });
    expect(chain.gte).toHaveBeenCalledWith('rating_avg', 4.0);
  });

  test('sort=ratingで評価順ソート', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ sort: 'rating' });
    expect(chain.order).toHaveBeenCalledWith('rating_avg', { ascending: false });
  });

  test('sort=popularで人気順ソート', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ sort: 'popular' });
    expect(chain.order).toHaveBeenCalledWith('view_count', expect.objectContaining({ ascending: false }));
  });

  test('デフォルトは作成日降順', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({});
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  test('geo検索でtype_filterが渡される', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, type: 'nail-eyelash' });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      type_filter: 'nail-eyelash',
    }));
  });

  test('geo検索でtype未指定はnull', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: null, error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5 });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      type_filter: null,
    }));
  });
});

// ─── getPopularFacilities (cache fallback) ───────────────────────────────────

describe('getPopularFacilities (cache fallback)', () => {
  test('cachedFetchが失敗した場合はDBへフォールバック', async () => {
    const facilities = [{ id: 'f-fallback', name: 'Fallback Salon' }];
    cachedFetch.mockRejectedValueOnce(new Error('Redis down'));
    const chain = fluent({ data: facilities, error: null });
    mockFrom.mockReturnValue(chain);
    const result = await getPopularFacilities(6);
    expect(result.facilities).toEqual(facilities);
  });
});

// ─── getFeaturedFacilities ───────────────────────────────────────────────────

/** fluent chain where limit() returns self (thenable), enabling further .or() chaining */
function fluentFeatured(resolvedValue: unknown) {
  const self: Record<string, jest.Mock | ((resolve: (v: unknown) => unknown) => Promise<unknown>)> = {};
  const handler = jest.fn(() => self);
  ['select', 'eq', 'neq', 'or', 'gte', 'lte', 'order', 'range', 'single', 'not', 'in', 'is', 'contains'].forEach(m => {
    self[m] = handler;
  });
  self.limit = jest.fn(() => self); // return self so .or() can be chained
  // Make self thenable so `await query` works
  self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  return self;
}

describe('getFeaturedFacilities', () => {
  test('広告枠なしの場合は空配列', async () => {
    const chain = fluentFeatured({ data: [] });
    mockFrom.mockReturnValue(chain);
    const result = await getFeaturedFacilities();
    expect(result).toEqual([]);
  });

  test('facility_card_viewのデータを抽出する', async () => {
    const facilityData = { id: 'f-feat', name: 'Featured Salon' };
    const chain = fluentFeatured({ data: [{ facility_card_view: facilityData }] });
    mockFrom.mockReturnValue(chain);
    const result = await getFeaturedFacilities();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(facilityData);
  });

  test('businessTypeフィルタを適用する', async () => {
    const chain = fluentFeatured({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getFeaturedFacilities('nail-eyelash');
    expect(chain.or).toHaveBeenCalled();
  });

  test('areaフィルタを適用する', async () => {
    const chain = fluentFeatured({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getFeaturedFacilities(undefined, '大阪府');
    expect(chain.or).toHaveBeenCalled();
  });

  test('nullなrowはfilterされる', async () => {
    const chain = fluentFeatured({ data: [{ facility_card_view: null }, { facility_card_view: { id: 'f-ok' } }] });
    mockFrom.mockReturnValue(chain);
    const result = await getFeaturedFacilities();
    expect(result).toHaveLength(1);
  });
});

// ─── getNearbyFacilities ─────────────────────────────────────────────────────

describe('getNearbyFacilities', () => {
  test('近隣施設を返す', async () => {
    const facilities = [{ id: 'f-nearby', name: 'Nearby Salon' }];
    const chain = fluent({ data: facilities });
    mockFrom.mockReturnValue(chain);
    const result = await getNearbyFacilities('f-1', '大阪府', '豊中市');
    expect(result).toEqual(facilities);
    expect(chain.neq).toHaveBeenCalledWith('id', 'f-1');
    expect(chain.eq).toHaveBeenCalledWith('prefecture', '大阪府');
    expect(chain.eq).toHaveBeenCalledWith('city', '豊中市');
  });

  test('nullデータの場合は空配列', async () => {
    const chain = fluent({ data: null });
    mockFrom.mockReturnValue(chain);
    const result = await getNearbyFacilities('f-1', '大阪府', '豊中市');
    expect(result).toEqual([]);
  });
});

// ─── getAvailableFacilityIds ─────────────────────────────────────────────────

describe('getAvailableFacilityIds', () => {
  /**
   * Build table-specific from() mock:
   * Each table returns a pre-set fluent chain resolving to given data.
   */
  function buildMultiTableMock(tables: Record<string, unknown[]>) {
    mockFrom.mockImplementation((table: string) => {
      const data = tables[table] ?? [];
      const chain = fluent({ data });
      // Make all terminal methods resolve immediately
      ['in', 'eq', 'not'].forEach(m => {
        chain[m] = jest.fn(() => chain);
      });
      // Force await to resolve
      (chain as unknown as PromiseLike<{ data: unknown[] }>).then =
        (resolve: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data }).then(resolve);
      return chain;
    });
  }

  test('空のfacilityIdsは空セットを返す', async () => {
    const result = await getAvailableFacilityIds([], '2026-05-01');
    expect(result.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('スタッフがいない場合は空セット', async () => {
    buildMultiTableMock({
      staff_schedules: [],
      staff_profiles: [],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.size).toBe(0);
  });

  test('空きスタッフがいる施設を返す', async () => {
    // staff-1 has a 9時間勤務、予約なし → available
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('休日スタッフは除外される', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [{ staff_id: 'staff-1', is_holiday: true }],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(false);
  });

  test('完全予約済みスタッフは除外される', async () => {
    // 勤務60分、予約60分 → bookedMinutes >= workMinutes → not available
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '10:00', end_time: '11:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [{ staff_id: 'staff-1', start_time: '10:00', end_time: '11:00' }],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(false);
  });

  test('morning timeslot: 午前専門スタッフは午前枠で有効', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '12:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'morning');
    expect(result.has('fac-1')).toBe(true);
  });

  test('afternoon timeslot: 午前専門スタッフは午後枠で無効', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '12:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'afternoon');
    expect(result.has('fac-1')).toBe(false);
  });

  test('evening timeslot: 夕方スタッフは夕方枠で有効', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '17:00', end_time: '22:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'evening');
    expect(result.has('fac-1')).toBe(true);
  });

  test('overrideで勤務時間が上書きされる', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [{ staff_id: 'staff-1', is_holiday: false, start_time: '13:00', end_time: '18:00' }],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'afternoon');
    expect(result.has('fac-1')).toBe(true);
  });

  test('スケジュールなしスタッフはスキップ', async () => {
    buildMultiTableMock({
      staff_schedules: [], // no schedule for this day
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(false);
  });
});
