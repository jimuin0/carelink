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

  // SEARCH-2: GPS 検索でも prefecture/city/rating_min/price_min/price_max を適用する
  // （RPC が type_filter しか受けず、これらが黙って無視されていた）。null 値は非 GPS の
  // .gte/.lte と同じく除外する。features/keyword は RPC が該当列を返さず JS 不可のため対象外。
  const geo = { lat: 35.68, lng: 139.76 };

  test('SEARCH-2: GPS + prefecture で都道府県フィルタが効く', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', prefecture: '東京都' },
      { id: 'b', prefecture: '大阪府' },
    ], error: null });
    const result = await searchFacilities({ ...geo, prefecture: '東京都' });
    expect(result.total).toBe(1);
    expect(result.facilities[0].id).toBe('a');
  });

  test('SEARCH-2: GPS + city で市区町村フィルタが効く', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', city: '渋谷区' },
      { id: 'b', city: '新宿区' },
    ], error: null });
    const result = await searchFacilities({ ...geo, city: '渋谷区' });
    expect(result.total).toBe(1);
    expect(result.facilities[0].id).toBe('a');
  });

  test('SEARCH-2: GPS + rating_min（null 評価は除外）', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', rating_avg: 4.5 },
      { id: 'b', rating_avg: 3.0 },
      { id: 'c', rating_avg: null },
    ], error: null });
    const result = await searchFacilities({ ...geo, rating_min: 4 });
    expect(result.total).toBe(1);
    expect(result.facilities[0].id).toBe('a');
  });

  test('SEARCH-2: GPS + price_min（null 価格は除外）', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', min_price: 1500 },
      { id: 'b', min_price: 500 },
      { id: 'c', min_price: null },
    ], error: null });
    const result = await searchFacilities({ ...geo, price_min: 1000 });
    expect(result.total).toBe(1);
    expect(result.facilities[0].id).toBe('a');
  });

  test('SEARCH-2: GPS + price_max（null 価格は除外）', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', max_price: 3000 },
      { id: 'b', max_price: 8000 },
      { id: 'c', max_price: null },
    ], error: null });
    const result = await searchFacilities({ ...geo, price_max: 5000 });
    expect(result.total).toBe(1);
    expect(result.facilities[0].id).toBe('a');
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

  test('sort=popularで人気順ソート（rating_count・view_count列は存在しない）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ sort: 'popular' });
    // facility_card_view に view_count は無いため rating_count で order する（旧 view_count は常に0件エラー）
    expect(chain.order).toHaveBeenCalledWith('rating_count', expect.objectContaining({ ascending: false }));
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

  test('staff_idなし予約はスキップされる', async () => {
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [{ staff_id: null, start_time: '10:00', end_time: '11:00' }],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('同施設の2人目スタッフはavailableSet確認でスキップ', async () => {
    buildMultiTableMock({
      staff_schedules: [
        { staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' },
        { staff_id: 'staff-2', start_time: '09:00', end_time: '18:00' },
      ],
      staff_profiles: [
        { id: 'staff-1', facility_id: 'fac-1' },
        { id: 'staff-2', facility_id: 'fac-1' },
      ],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
    expect(result.size).toBe(1);
  });

  test('staffSchedulesがnullの場合も動作する', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        const chain = fluent({ data: [{ id: 'staff-1', facility_id: 'fac-1' }] });
        ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
        (chain as unknown as PromiseLike<unknown>).then =
          (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'staff-1', facility_id: 'fac-1' }] }).then(resolve);
        return chain;
      }
      // Other tables return null data
      const chain = fluent({ data: null });
      ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
      (chain as unknown as PromiseLike<unknown>).then =
        (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null }).then(resolve);
      return chain;
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.size).toBe(0);
  });
});

// ─── null data fallback branches ────────────────────────────────────────────

describe('null data fallbacks', () => {
  test('searchFacilities: dataがnullのとき空配列', async () => {
    const chain = fluent({ data: null, count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    const result = await searchFacilities({});
    expect(result.facilities).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('getPopularFacilities: 引数なし（デフォルトlimit=6）', async () => {
    const chain = fluent({ data: [], error: null });
    mockFrom.mockReturnValue(chain);
    const result = await getPopularFacilities();
    expect(result.facilities).toEqual([]);
  });

  test('getLatestFacilities: 引数なし（デフォルトlimit=6）', async () => {
    const chain = fluent({ data: [], error: null });
    mockFrom.mockReturnValue(chain);
    const result = await getLatestFacilities();
    expect(result.facilities).toEqual([]);
  });

  test('getFacilityMenus: dataがnullのとき空配列', async () => {
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: null, error: null }));
    mockFrom.mockReturnValue(chain);
    const result = await getFacilityMenus('fac-1');
    expect(result.menus).toEqual([]);
  });

  test('getFacilityPhotos: dataがnullのとき空配列', async () => {
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: null, error: null }));
    mockFrom.mockReturnValue(chain);
    const result = await getFacilityPhotos('fac-1');
    expect(result.photos).toEqual([]);
  });

  test('getFacilityReviews: dataがnullのとき空配列', async () => {
    const chain = fluent(null);
    chain.order = jest.fn(() => Promise.resolve({ data: null, error: null }));
    mockFrom.mockReturnValue(chain);
    const result = await getFacilityReviews('fac-1');
    expect(result.reviews).toEqual([]);
  });

  test('getSimilarFacilities: dataがnullのとき空配列', async () => {
    const chain = fluent({ data: null });
    mockFrom.mockReturnValue(chain);
    const result = await getSimilarFacilities('f-1', 'ヘアサロン', '東京都');
    expect(result).toEqual([]);
  });

  test('getMonthlyBookingCounts: dataがnullのとき空オブジェクト', async () => {
    const chain = fluent(null);
    chain.lt = jest.fn(() => Promise.resolve({ data: null }));
    mockFrom.mockReturnValue(chain);
    const result = await getMonthlyBookingCounts(['f-1']);
    expect(result).toEqual({});
  });

  test('searchFacilities: lat のみ指定（geo検索とみなさない）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    // lat だけで lng が null → isGeoSearch=false → range が呼ばれる
    await searchFacilities({ lat: 35.0 });
    expect(chain.range).toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('searchFacilities: lng のみ指定（geo検索とみなさない）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ lng: 139.0 });
    expect(chain.range).toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('searchFacilities: geo 検索 + data が undefined → 空配列', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: undefined, error: null });
    const result = await searchFacilities({ lat: 34.7, lng: 135.5, page: 1 });
    expect(result.facilities).toEqual([]);
    expect(result.total).toBe(0);
  });

  test('searchFacilities: keyword に %, _, \\ が含まれる場合エスケープされる', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ keyword: '100%_off\\test' });
    // fluent() の全メソッドは同一 handler を共有するため
    // ilike を含む呼び出しが OR 条件の呼び出しを特定する
    const allCalls = (chain.or as jest.Mock).mock.calls as unknown[][];
    const orCallArgs = allCalls.find((c) => typeof c[0] === 'string' && (c[0] as string).includes('ilike'));
    expect(orCallArgs).toBeDefined();
    expect(orCallArgs![0]).toContain('\\%');
    expect(orCallArgs![0]).toContain('\\_');
    expect(orCallArgs![0]).toContain('\\\\');
  });

  test('getAvailableFacilityIds: 時刻フォーマット h のみ (分なし) も処理する', async () => {
    // timeToMinutes が "10" → h*60 + 0 を返す経路を踏む
    mockFrom.mockImplementation((table: string) => {
      const map: Record<string, unknown[]> = {
        staff_schedules: [{ staff_id: 's-1', start_time: '10', end_time: '11' }],
        staff_profiles: [{ id: 's-1', facility_id: 'fac-1' }],
        schedule_overrides: [],
        bookings: [],
      };
      const data = map[table] ?? [];
      const chain = fluent({ data });
      ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
      (chain as unknown as PromiseLike<unknown>).then =
        (resolve: (v: unknown) => unknown) => Promise.resolve({ data }).then(resolve);
      return chain;
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('getAvailableFacilityIds: bookings.start/end 時刻が end <= start → bookedMinutes=0', async () => {
    // Math.max(0, end-start) の Math.max 分岐をテスト
    mockFrom.mockImplementation((table: string) => {
      const map: Record<string, unknown[]> = {
        staff_schedules: [{ staff_id: 's-1', start_time: '09:00', end_time: '18:00' }],
        staff_profiles: [{ id: 's-1', facility_id: 'fac-1' }],
        schedule_overrides: [],
        bookings: [{ staff_id: 's-1', start_time: '11:00', end_time: '10:00' }],
      };
      const data = map[table] ?? [];
      const chain = fluent({ data });
      ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
      (chain as unknown as PromiseLike<unknown>).then =
        (resolve: (v: unknown) => unknown) => Promise.resolve({ data }).then(resolve);
      return chain;
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('getMonthlyBookingCounts: 12月は翌年1月を計算', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-15T00:00:00Z'));
    const chain = fluent(null);
    chain.lt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockReturnValue(chain);
    await getMonthlyBookingCounts(['f-1']);
    const ltCall = (chain.lt as jest.Mock).mock.calls[0];
    expect(ltCall[1]).toBe('2027-01-01');
    jest.useRealTimers();
  });

  test('getMonthlyBookingCounts: JST月初早朝(UTCは前月末)でも当月=JST月で集計（旧 getMonth ズレを解消・回帰防止）', async () => {
    jest.useFakeTimers();
    // UTC 2026-06-30 17:00 = JST 2026-07-01 02:00（旧実装は UTC=6/30 のため前月6月を集計してしまう帯）
    jest.setSystemTime(new Date('2026-06-30T17:00:00Z'));
    const chain = fluent(null);
    chain.gte = jest.fn(() => chain);
    chain.lt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockReturnValue(chain);
    await getMonthlyBookingCounts(['f-1']);
    // JST では既に7月 → 当月境界は 7/1〜8/1 でなければならない（旧実装だと 6/1〜7/1）
    expect((chain.gte as jest.Mock).mock.calls[0]).toEqual(['booking_date', '2026-07-01']);
    expect((chain.lt as jest.Mock).mock.calls[0]).toEqual(['booking_date', '2026-08-01']);
    jest.useRealTimers();
  });

  // Branch coverage: line 94 — getPopularFacilities cachedFetch 内部で data が null の場合
  test('getPopularFacilities: cachedFetch 内部 data が null → 空配列を返す', async () => {
    // cachedFetch mock が fetcher() を呼ぶので limit() が { data: null } を返すようにする
    const chain = fluent({ data: null, error: null });
    mockFrom.mockReturnValue(chain);
    const result = await getPopularFacilities(6);
    expect(result.facilities).toEqual([]);
  });

  // Branch coverage: line 108 — getPopularFacilities フォールバック時 data が null
  test('getPopularFacilities: フォールバック時 data が null → 空配列', async () => {
    cachedFetch.mockRejectedValueOnce(new Error('Redis down'));
    const chain = fluent({ data: null, error: null });
    mockFrom.mockReturnValue(chain);
    const result = await getPopularFacilities(6);
    expect(result.facilities).toEqual([]);
  });

  // Branch coverage: line 130 — getFeaturedFacilities で data が null の場合
  test('getFeaturedFacilities: data が null → 空配列', async () => {
    const chain = fluentFeatured({ data: null });
    mockFrom.mockReturnValue(chain);
    const result = await getFeaturedFacilities();
    expect(result).toEqual([]);
  });

  // Branch coverage: line 215 — getLatestFacilities で data が null の場合
  // .select().eq().order().limit() チェーンのうち limit() を上書きして null data を返す
  test('getLatestFacilities: limit() が { data: null } を返す → 空配列', async () => {
    const chain = fluent(null);
    chain.limit = jest.fn(() => Promise.resolve({ data: null, error: null }));
    mockFrom.mockReturnValue(chain);
    const result = await getLatestFacilities(6);
    expect(result.facilities).toEqual([]);
  });
});
