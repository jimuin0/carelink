const mockFrom = jest.fn();
// 【2026年7月16日】getAvailableFacilityIds の bookings 読み取り／getMonthlyBookingCounts
// 全体は service role クライアントを使う（anon RLSで常に0行になる #483/#484 同型バグの根治）。
// mockFrom（anon＝createServerSupabaseClient）と mockServiceFrom（service role＝
// createServiceRoleClient）を別々のモックにすることで、「bookings は必ず service role
// 経由で読む」ことをテストで直接検証できるようにする（anon 経由に退行したら即座にテスト赤化）。
const mockServiceFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (fn: unknown) => fn,
}));

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
  createServiceRoleClient: () => ({ from: mockServiceFrom, rpc: mockRpc }),
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
  getAvailableAreasAndTypes,
  getFacilityCancelPolicy,
  keywordTerms,
  KEYWORD_MAX_TERMS,
  facilityOpenWindow,
} from '../facilities';

// ─── 複数語キーワード（2026年8月11日 恒久根治）─────────────────────────────
// 入力全体を1つの ILIKE パターンにしていたため「豊中 まつげ」等が常に0件だった。
// 本番の特集 eyelash-special が filter_keyword「まつ毛 パーマ エクステ」で0件になっていた実例あり。
describe('keywordTerms', () => {
  test('半角スペースで分割する', () => {
    expect(keywordTerms('豊中 まつげ')).toEqual(['豊中', 'まつげ']);
  });

  test('全角スペース(U+3000)でも分割する（日本語入力の既定）', () => {
    expect(keywordTerms('豊中　まつげ')).toEqual(['豊中', 'まつげ']);
  });

  test('連続・混在した空白をまとめて1区切りにする', () => {
    expect(keywordTerms('豊中 　  まつげ')).toEqual(['豊中', 'まつげ']);
  });

  test('前後の空白で空文字の語を作らない', () => {
    expect(keywordTerms('  豊中  ')).toEqual(['豊中']);
  });

  test('空白のみの入力は語ゼロ', () => {
    expect(keywordTerms('   ')).toEqual([]);
    expect(keywordTerms('')).toEqual([]);
  });

  test('単語1つは従来どおりそのまま', () => {
    expect(keywordTerms('まつげ')).toEqual(['まつげ']);
  });

  test(`語数は ${KEYWORD_MAX_TERMS} 個で打ち切る`, () => {
    const terms = keywordTerms('a b c d e f g h');
    expect(terms).toHaveLength(KEYWORD_MAX_TERMS);
    expect(terms).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('100文字で切ってから分割する（長大入力の防御）', () => {
    const long = 'あ'.repeat(120) + ' まつげ';
    // 100文字目までに空白が無いので語は1つだけになる
    expect(keywordTerms(long)).toEqual(['あ'.repeat(100)]);
  });
});

const { cachedFetch } = require('../redis');

beforeEach(() => {
  mockFrom.mockReset();
  mockServiceFrom.mockReset();
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
  self.maybeSingle = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

type Calls = Record<string, unknown[][]>;

/**
 * テーブルごとに別チェーンを返す from() モック。終端（range / maybeSingle / limit）で
 * resolve(table, calls) を返す。calls には各メソッドの呼び出し引数が積まれるので、
 * 同じテーブルへの別クエリ（価格帯と保険適用の facility_menus 等）も中身で見分けられる。
 */
function routeFrom(resolve: (table: string, calls: Calls) => unknown) {
  const made: { table: string; calls: Calls }[] = [];
  mockFrom.mockImplementation((table: string) => {
    const calls: Calls = {};
    const self: Record<string, jest.Mock> = {};
    const record = (name: string, args: unknown[]) => { (calls[name] ||= []).push(args); };
    for (const m of ['select', 'eq', 'neq', 'or', 'gte', 'lte', 'in', 'contains', 'order']) {
      self[m] = jest.fn((...args: unknown[]) => { record(m, args); return self; });
    }
    for (const m of ['range', 'maybeSingle', 'limit']) {
      self[m] = jest.fn((...args: unknown[]) => { record(m, args); return Promise.resolve(resolve(table, calls)); });
    }
    made.push({ table, calls });
    return self;
  });
  return made;
}

function callsTo(made: { table: string; calls: Calls }[], table: string): Calls[] {
  return made.filter((m) => m.table === table).map((m) => m.calls);
}

const ids = (...list: string[]) => list.map((facility_id) => ({ facility_id }));

const OPEN_ALL_WEEK: Record<string, { open: string; close: string } | null> = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);

/** ネット予約の準備が整った施設カード（isCardBookingReady が真）。2026-05-01 は金曜。 */
function readyCard(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: 'テスト鍼灸院', prefecture: '大阪府', city: '大阪市北区', business_hours: OPEN_ALL_WEEK,
    photo_count: 1, booking_menu_count: 1, active_staff_count: 1, has_address: true, ...overrides,
  };
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
    // 【監査C1回帰・恒久根治完了】migration 20260722000002 で facility_card_view に nearest_station を
    // 射影したため、access_info（アクセス自由記述）に加え nearest_station（最寄駅名）も検索対象にして
    // GPS/非GPS の駅名検索を対称化する。両列の .ilike が .or() に含まれることを固定する
    // （view 実在列のみを参照＝過去の 400 全滅の再発防止）。
    const orFilter = call![0] as string;
    expect(orFilter).toContain('access_info.ilike.');
    expect(orFilter).toContain('nearest_station.ilike.');
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

  // 【2026年10月22日 是正】旧実装は view の min_price >= 下限 かつ max_price <= 上限＝
  // 「全メニューが範囲内」の施設しか当てなかった。範囲内の公開メニューが 1 つでもあれば当てる。
  test('価格帯は範囲内の公開メニューを1つでも持つ施設で絞る（全メニューが範囲内である必要はない）', async () => {
    const made = routeFrom((table) => table === 'facility_menus'
      ? { data: ids('a', 'a', 'b'), error: null }
      : { data: [{ id: 'a' }, { id: 'b' }], count: 2, error: null });

    const result = await searchFacilities({ price_min: 3000, price_max: 10000 });

    const [menu] = callsTo(made, 'facility_menus');
    expect(menu.select).toEqual([['facility_id']]);
    expect(menu.or).toEqual([['is_published.is.null,is_published.eq.true']]);
    expect(menu.gte).toEqual([['price', 3000]]);
    expect(menu.lte).toEqual([['price', 10000]]);
    const [card] = callsTo(made, 'facility_card_view');
    expect(card.in).toEqual([['id', ['a', 'b']]]);
    expect(card.gte).toBeUndefined();
    expect(card.lte).toBeUndefined();
    expect(result.total).toBe(2);
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

  test('GPS + 価格帯も範囲内メニューを持つ施設の id で絞る（施設全体の最安・最高では判定しない）', async () => {
    // a: 1,000円と20,000円のメニュー（5,000円のメニューも持つ）。旧実装は min_price 1000 < 3000 で落としていた。
    routeFrom((table) => (table === 'facility_menus' ? { data: ids('a'), error: null } : { data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [
      { id: 'a', min_price: 1000, max_price: 20000 },
      { id: 'b', min_price: 4000, max_price: 6000 },
      { id: 'c', min_price: null, max_price: null },
    ], error: null });
    const result = await searchFacilities({ ...geo, price_min: 3000, price_max: 8000 });
    expect(result.facilities.map((f) => f.id)).toEqual(['a']);
    expect(result.total).toBe(1);
  });

  test('GPS + 該当メニューなしは RPC を呼ばずに 0 件', async () => {
    routeFrom(() => ({ data: [], error: null }));
    const result = await searchFacilities({ ...geo, price_max: 500 });
    expect(result).toEqual({ facilities: [], total: 0, perPage: 20, error: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ─── 価格帯・保険適用・症状（2026年10月22日 是正）──────────────────────────────
// 症状・保険適用は絞り込みパネルが URL に書いていたのに検索が読まず、無視されていた。
describe('searchFacilities: メニュー単位・症状の絞り込み', () => {
  test('下限だけなら gte のみ、上限だけなら lte のみ', async () => {
    let made = routeFrom((table) => (table === 'facility_menus' ? { data: ids('a'), error: null } : { data: [], count: 0, error: null }));
    await searchFacilities({ price_min: 3000 });
    expect(callsTo(made, 'facility_menus')[0].gte).toEqual([['price', 3000]]);
    expect(callsTo(made, 'facility_menus')[0].lte).toBeUndefined();

    made = routeFrom((table) => (table === 'facility_menus' ? { data: ids('a'), error: null } : { data: [], count: 0, error: null }));
    await searchFacilities({ price_max: 5000 });
    expect(callsTo(made, 'facility_menus')[0].gte).toBeUndefined();
    expect(callsTo(made, 'facility_menus')[0].lte).toEqual([['price', 5000]]);
  });

  test('該当メニューが無ければ 0 件（絞り込みなしの全件に戻さない）', async () => {
    const made = routeFrom(() => ({ data: [], count: 99, error: null }));
    const result = await searchFacilities({ price_min: 999999 });
    expect(result).toEqual({ facilities: [], total: 0, perPage: 20, error: null });
    expect(callsTo(made, 'facility_card_view')).toHaveLength(0);
  });

  test('保険適用は insurance_covered の公開メニューを持つ施設に絞る', async () => {
    const made = routeFrom((table) => (table === 'facility_menus'
      ? { data: ids('b'), error: null }
      : { data: [{ id: 'b' }], count: 1, error: null }));
    const result = await searchFacilities({ insurance: true });
    const [menu] = callsTo(made, 'facility_menus');
    expect(menu.eq).toEqual([['insurance_covered', true]]);
    expect(menu.or).toEqual([['is_published.is.null,is_published.eq.true']]);
    expect(callsTo(made, 'facility_card_view')[0].in).toEqual([['id', ['b']]]);
    expect(result.total).toBe(1);
  });

  test('insurance=false は条件なし（facility_menus を読まない）', async () => {
    const made = routeFrom(() => ({ data: [], count: 0, error: null }));
    await searchFacilities({ insurance: false });
    expect(callsTo(made, 'facility_menus')).toHaveLength(0);
    expect(callsTo(made, 'facility_card_view')[0].in).toBeUndefined();
  });

  test('症状は名前で symptoms を引き、facility_symptoms に登録された施設に絞る（前後の空白は除く）', async () => {
    const made = routeFrom((table) => {
      if (table === 'symptoms') return { data: { id: 'sym-1' }, error: null };
      if (table === 'facility_symptoms') return { data: ids('c'), error: null };
      return { data: [{ id: 'c' }], count: 1, error: null };
    });
    const result = await searchFacilities({ symptom: ' 腰痛 ' });
    expect(callsTo(made, 'symptoms')[0].eq).toEqual([['name', '腰痛']]);
    expect(callsTo(made, 'facility_symptoms')[0].eq).toEqual([['symptom_id', 'sym-1']]);
    expect(callsTo(made, 'facility_card_view')[0].in).toEqual([['id', ['c']]]);
    expect(result.total).toBe(1);
  });

  test('症状名は長さを切ってから引く', async () => {
    const made = routeFrom(() => ({ data: null, error: null }));
    await searchFacilities({ symptom: 'あ'.repeat(80) });
    expect(callsTo(made, 'symptoms')[0].eq).toEqual([['name', 'あ'.repeat(50)]]);
  });

  test('マスタに無い症状名は 0 件（facility_symptoms を読まない）', async () => {
    const made = routeFrom(() => ({ data: null, error: null }));
    const result = await searchFacilities({ symptom: '存在しない症状' });
    expect(result).toEqual({ facilities: [], total: 0, perPage: 20, error: null });
    expect(callsTo(made, 'facility_symptoms')).toHaveLength(0);
    expect(callsTo(made, 'facility_card_view')).toHaveLength(0);
  });

  test('空白だけの症状は条件なし', async () => {
    const made = routeFrom(() => ({ data: [], count: 0, error: null }));
    await searchFacilities({ symptom: '   ' });
    expect(callsTo(made, 'symptoms')).toHaveLength(0);
    expect(callsTo(made, 'facility_card_view')[0].in).toBeUndefined();
  });

  test('複数の条件は施設単位の AND（それぞれを満たす施設の共通部分）', async () => {
    const made = routeFrom((table, calls) => {
      if (table === 'facility_menus') {
        const insurance = (calls.eq ?? []).some(([col]) => col === 'insurance_covered');
        return { data: insurance ? ids('b', 'c') : ids('a', 'b'), error: null };
      }
      if (table === 'symptoms') return { data: { id: 'sym-1' }, error: null };
      if (table === 'facility_symptoms') return { data: ids('b', 'd'), error: null };
      return { data: [{ id: 'b' }], count: 1, error: null };
    });
    await searchFacilities({ price_min: 1000, insurance: true, symptom: '肩こり' });
    expect(callsTo(made, 'facility_menus')).toHaveLength(2);
    expect(callsTo(made, 'facility_card_view')[0].in).toEqual([['id', ['b']]]);
  });

  test.each([
    ['symptoms', { symptom: '腰痛' }],
    ['facility_symptoms', { symptom: '腰痛' }],
    ['facility_menus', { insurance: true }],
  ] as const)('%s の読み取りエラーは 0 件ではなくエラーとして返す（全件にも倒さない）', async (failing, params) => {
    const boom = { message: 'boom' };
    const made = routeFrom((table) => {
      if (table === failing) return { data: null, error: boom };
      if (table === 'symptoms') return { data: { id: 'sym-1' }, error: null };
      return { data: ids('a'), error: null };
    });
    const result = await searchFacilities(params);
    expect(result).toEqual({ facilities: [], total: 0, perPage: 20, error: boom });
    expect(callsTo(made, 'facility_card_view')).toHaveLength(0);
  });

  test('PostgREST の上限（1,000行）を跨いで全ページ読む（取りこぼした施設を黙って落とさない）', async () => {
    const made = routeFrom((table, calls) => {
      if (table !== 'facility_menus') return { data: [], count: 0, error: null };
      const [offset] = calls.range[calls.range.length - 1] as [number, number];
      return { data: offset === 0 ? Array.from({ length: 1000 }, () => ({ facility_id: 'a' })) : ids('z'), error: null };
    });
    await searchFacilities({ price_min: 1000 });
    expect(callsTo(made, 'facility_menus').map((c) => c.range[0])).toEqual([[0, 999], [1000, 1999]]);
    expect(callsTo(made, 'facility_card_view')[0].in).toEqual([['id', ['a', 'z']]]);
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

  // 【2026年7月8日 恒久根治の回帰防止】同点施設(rating_count同値)の表示順を決定的にする。
  test('idを二次キー(昇順)として付与する', async () => {
    const chain = fluent({ data: [], error: null });
    mockFrom.mockReturnValue(chain);
    await getPopularFacilities(6);
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
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

describe('getFacilityCancelPolicy（2026年7月15日 追加・予約確認画面のキャンセルポリシー表示用）', () => {
  test('行が存在すればポリシーを返す', async () => {
    const policy = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100, policy_text: '注意事項' };
    const chain = fluent({ data: policy, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityCancelPolicy('fac-1');
    expect(result).toEqual(policy);
    expect(mockFrom).toHaveBeenCalledWith('facility_cancel_policies');
  });

  test('未設定施設（行が存在しない・data=null）は null を返す（グレースフルに非表示）', async () => {
    const chain = fluent({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityCancelPolicy('fac-1');
    expect(result).toBeNull();
  });

  test('取得失敗（error）でも例外を投げず null を返す（表示専用の付加情報のため予約フローをブロックしない）', async () => {
    const chain = fluent({ data: null, error: new Error('db down') });
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityCancelPolicy('fac-1');
    expect(result).toBeNull();
  });

  test('error が真かつ data が非null（本来ありえないPostgREST応答だが防御的にnullを返す）', async () => {
    // 実際のSupabase応答では error と data が同時に真になることは無いが、
    // 「error があれば data の有無に関わらず null」という契約自体を固定するための境界テスト。
    const chain = fluent({ data: { free_cancel_hours: 24, late_cancel_rate: 50 }, error: new Error('db down') });
    mockFrom.mockReturnValue(chain);

    const result = await getFacilityCancelPolicy('fac-1');
    expect(result).toBeNull();
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

  // 【2026年7月8日 恒久根治の回帰防止】同一時刻に登録された施設の表示順を決定的にする。
  test('idを二次キー(昇順)として付与する', async () => {
    const chain = fluent({ data: [], error: null });
    mockFrom.mockReturnValue(chain);
    await getLatestFacilities(6);
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
  });
});

// 【2026年7月28日・恒久是正の回帰防止】検索0件画面の再検索候補は、以前は東京都・愛知県など
// 掲載施設が1件も無いエリアを固定表示しており、押しても再び0件になる（0件→0件の連鎖）状態だった。
// 候補を DB の実在値だけから引くことで乖離経路を断つのが本関数の目的なので、
// 「実在値だけを返す」「重複を潰す」「null/空を候補にしない」を退行させないよう固定する。
describe('getAvailableAreasAndTypes', () => {
  // この関数は .eq() が終端（await される）ため、fluent() ではなく eq が Promise を返すモックを使う。
  function eqTerminal(resolvedValue: unknown) {
    const eq = jest.fn(() => Promise.resolve(resolvedValue));
    const select = jest.fn(() => ({ eq }));
    return { select, eq };
  }

  test('Supabase query が Error で reject → 空配列へフォールバックする', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const eq = jest.fn(() =>
      Promise.reject(new Error('query failed')),
    );

    const select = jest.fn(() => ({ eq }));

    mockFrom.mockReturnValue({ select, eq });

    const result = await getAvailableAreasAndTypes();

    expect(result).toEqual({
      areas: [],
      types: [],
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[facilities] getAvailableAreasAndTypes failed:',
      'query failed',
    );

    consoleSpy.mockRestore();
  });

  test('Supabase query が Error 以外で reject → 空配列へフォールバックする', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const eq = jest.fn(() =>
      Promise.reject('query failed'),
    );

    const select = jest.fn(() => ({ eq }));

    mockFrom.mockReturnValue({ select, eq });

    const result = await getAvailableAreasAndTypes();

    expect(result).toEqual({
      areas: [],
      types: [],
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[facilities] getAvailableAreasAndTypes failed:',
      'query failed',
    );

    consoleSpy.mockRestore();
  });

  test('公開施設が実在する都道府県・業種のみを重複なしで返す', async () => {
    const chain = eqTerminal({
      data: [
        { prefecture: '大阪府', business_type: '鍼灸・整骨院' },
        { prefecture: '大阪府', business_type: 'まつげ・眉毛サロン' },
        { prefecture: '大阪府', business_type: '鍼灸・整骨院' },
      ],
    });

    mockFrom.mockReturnValue(chain);

    const result = await getAvailableAreasAndTypes();

    expect(result.areas).toEqual(['大阪府']);
    expect(result.types).toEqual([
      '鍼灸・整骨院',
      'まつげ・眉毛サロン',
    ]);

    // 非公開（draft 等）の施設を候補に混ぜない。
    expect(chain.eq).toHaveBeenCalledWith(
      'status',
      'published',
    );
  });

  test('null・空文字はリンク先が壊れるため候補から除外する', async () => {
    const chain = eqTerminal({
      data: [
        { prefecture: null, business_type: '' },
        { prefecture: '大阪府', business_type: '鍼灸・整骨院' },
      ],
    });

    mockFrom.mockReturnValue(chain);

    const result = await getAvailableAreasAndTypes();

    expect(result.areas).toEqual(['大阪府']);
    expect(result.types).toEqual(['鍼灸・整骨院']);
  });

  test('取得失敗（data が null）でも空配列を返し画面を壊さない', async () => {
    mockFrom.mockReturnValue(
      eqTerminal({
        data: null,
        error: { message: 'boom' },
      }),
    );

    const result = await getAvailableAreasAndTypes();

    expect(result).toEqual({
      areas: [],
      types: [],
    });
  });

  test('data が null かつ error なし → 空配列を返す', async () => {
    mockFrom.mockReturnValue(
      eqTerminal({
        data: null,
        error: null,
      }),
    );

    const result = await getAvailableAreasAndTypes();

    expect(result).toEqual({
      areas: [],
      types: [],
    });
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

  // 【2026年7月8日 恒久根治の回帰防止】同点施設の表示順を決定的にする。
  test('idを二次キー(昇順)として付与する', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getSimilarFacilities('f-1', 'ヘアサロン', '東京都');
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
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
    mockServiceFrom.mockReturnValue(chain);

    const result = await getMonthlyBookingCounts(['f-1', 'f-2']);
    expect(result).toEqual({ 'f-1': 2, 'f-2': 1 });
  });

  test('空配列の場合は空オブジェクト', async () => {
    const result = await getMonthlyBookingCounts([]);
    expect(result).toEqual({});
  });

  // 【2026年7月16日 恒久根治の回帰防止・#483/#484同型】bookings の SELECT RLS は
  // auth.uid()=user_id のため anon では常に0行になり「今月N件予約」バッジが全店で
  // 非表示になっていた。service role クライアント経由であることを直接検証する
  // （anon(mockFrom) に退行したら bookings は取得されず 0 になり、この test が赤化する）。
  test('bookings読み取りはanonではなくservice roleクライアント経由（#483/#484同型の回帰防止）', async () => {
    const bookings = [{ facility_id: 'f-1' }];
    const chain = fluent(null);
    chain.lt = jest.fn(() => Promise.resolve({ data: bookings }));
    mockServiceFrom.mockReturnValue(chain);
    // anon の from が bookings 目的で呼ばれたら壊す（anon退行を検知するための毒餌）
    mockFrom.mockImplementation(() => {
      throw new Error('anon client must not be used for bookings reads');
    });

    const result = await getMonthlyBookingCounts(['f-1']);
    expect(result).toEqual({ 'f-1': 1 });
    expect(mockServiceFrom).toHaveBeenCalledWith('bookings');
    expect(mockFrom).not.toHaveBeenCalled();
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

  // 【2026年7月8日 恒久根治の回帰防止】単一列ORDER BYだと同点施設の順序をPostgreSQLが保証せず、
  // range()によるページングと組み合わさると同点施設が別ページに重複/欠落しうる。全ソート分岐で
  // idを二次キー(昇順)にして順序を決定的にする。
  test('sort=rating/popular/デフォルト全てでidを二次キー(昇順)として付与する', async () => {
    for (const sort of ['rating', 'popular', undefined] as const) {
      const chain = fluent({ data: [], count: 0, error: null });
      mockFrom.mockReturnValue(chain);
      await searchFacilities(sort ? { sort } : {});
      expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
    }
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

  // 【型修正・src/lib/facilities.ts】RPC引数の生成型（database.types.ts）は
  // type_filter?: string（= string | undefined）で null を受け付けないため、
  // null ではなく undefined を渡すよう修正した。supabase-js は .rpc() の引数を
  // JSON.stringify するため undefined のキーは JSON から消え、PostgREST 側は
  // 未指定＝SQL の DEFAULT NULL として扱う。null 明示と undefined 省略は
  // 実行時の意味が同じなので、期待値だけを undefined に更新する（挙動は不変）。
  test('geo検索でtype未指定はundefined', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: null, error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5 });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      type_filter: undefined,
    }));
  });

  // 【2026年7月10日 恒久根治の回帰】GPS検索でも keyword/features がRPCに渡り、
  // DB側(migration 20260710000001)で絞り込まれることを保証する。
  test('geo検索でkeywordがRPCのkeyword_filterに渡る（ワイルドカードはエスケープ）', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, keyword: '100%オフ_割引' });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      keyword_filter: '100\\%オフ\\_割引',
    }));
  });

  // GPS 経路も非GPS と同じ AND 意味論にする（migration 20260812000001 が RPC 側で再分割）。
  // 片方だけ直すと 20260710000001 が解消した「GPSと非GPSで結果が食い違う」非対称が再発する。
  test('geo検索で複数語キーワードは語数上限を適用して半角空白で連結して渡す', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, keyword: '豊中　まつ毛 パーマ エクステ ネイル 追加語' });
    expect(mockRpc).toHaveBeenCalledWith(
      'search_facilities_nearby',
      expect.objectContaining({ keyword_filter: '豊中 まつ毛 パーマ エクステ ネイル' })
    );
  });

  // 【型修正・src/lib/facilities.ts】keyword_filter?: string（= string | undefined）
  // のため null ではなく undefined を渡す（上の type_filter と同じ理由・挙動は不変）。
  test('geo検索で空白のみのキーワードはundefined（語ゼロを空文字で渡さない）', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, keyword: '  　 ' });
    expect(mockRpc).toHaveBeenCalledWith(
      'search_facilities_nearby',
      expect.objectContaining({ keyword_filter: undefined })
    );
  });

  test('geo検索でkeyword未指定はundefined', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5 });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      keyword_filter: undefined,
    }));
  });

  test('geo検索でfeaturesがRPCのfeatures_filterに渡る', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, features: ['駐車場', '個室'] });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      features_filter: ['駐車場', '個室'],
    }));
  });

  // 【型修正・src/lib/facilities.ts】features_filter?: string[]（= string[] | undefined）
  // のため null ではなく undefined を渡す（上の type_filter と同じ理由・挙動は不変）。
  test('geo検索でfeatures未指定(空配列含む)はundefined', async () => {
    mockFrom.mockReturnValue(fluent({ data: [], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    await searchFacilities({ lat: 34.7, lng: 135.5, features: [] });
    expect(mockRpc).toHaveBeenCalledWith('search_facilities_nearby', expect.objectContaining({
      features_filter: undefined,
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

  // 【2026年7月8日 恒久根治の回帰防止】同点施設の表示順を決定的にする。
  test('idを二次キー(昇順)として付与する', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);
    await getNearbyFacilities('f-1', '大阪府', '豊中市');
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
  });
});

// ─── getAvailableFacilityIds ─────────────────────────────────────────────────

describe('getAvailableFacilityIds', () => {
  /**
   * Build table-specific from() mock。
   * 【2026年7月16日】bookings は service role クライアント（mockServiceFrom）、
   * それ以外（staff_schedules/staff_profiles/schedule_overrides）は従来どおり anon
   * クライアント（mockFrom）から返す。anon 経由で bookings が読まれたら例外を投げ、
   * #483/#484 同型バグへの退行を即座に検知する。
   */
  function buildMultiTableMock(tables: Record<string, unknown[]>) {
    // facility_card_view を指定しないテストは「fac-1 は予約準備済み・毎日 08:00-23:00 営業」とする。
    const rows: Record<string, unknown[]> = { facility_card_view: [readyCard('fac-1')], ...tables };
    const chains: Record<string, Record<string, jest.Mock>> = {};
    function makeChain(data: unknown[]) {
      const chain = fluent({ data });
      // Make all terminal methods resolve immediately
      ['in', 'eq', 'not'].forEach(m => {
        chain[m] = jest.fn(() => chain);
      });
      // Force await to resolve
      (chain as unknown as PromiseLike<{ data: unknown[] }>).then =
        (resolve: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data }).then(resolve);
      return chain;
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        throw new Error('anon client(createServerSupabaseClient) must not read bookings — use service role');
      }
      chains[table] = makeChain(rows[table] ?? []);
      return chains[table];
    });
    mockServiceFrom.mockImplementation((table: string) => {
      if (table !== 'bookings') {
        throw new Error(`service role client should only be used for bookings, got: ${table}`);
      }
      chains[table] = makeChain(rows[table] ?? []);
      return chains[table];
    });
    return chains;
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

  // 【2026年7月9日 恒久根治の回帰】時間帯フィルタは勤務・予約を要求ウィンドウにクリップして判定する。
  test('morning timeslot: 全日勤務で午前が満枠なら午前検索では無効（クリップ判定）', async () => {
    // staff-1 は 09:00-18:00 勤務だが午前(09:00-12:00)が予約で埋まっている。
    // 旧実装は全日(540分)>全予約(180分)で「空きあり」と誤表示していた。
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '12:00' }],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'morning');
    expect(result.has('fac-1')).toBe(false);
  });

  test('morning timeslot: 午後の予約は午前検索の空き判定に影響しない（予約をウィンドウにクリップ）', async () => {
    // staff-1 は 09:00-18:00 勤務・予約は午後(14:00-18:00)のみ → 午前は空き。
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [{ staff_id: 'staff-1', start_time: '14:00', end_time: '18:00' }],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'morning');
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
    function nullChain() {
      const chain = fluent({ data: null });
      ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
      (chain as unknown as PromiseLike<unknown>).then =
        (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null }).then(resolve);
      return chain;
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'facility_card_view') {
        const card = [readyCard('fac-1')];
        const chain = fluent({ data: card });
        ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
        (chain as unknown as PromiseLike<unknown>).then =
          (resolve: (v: unknown) => unknown) => Promise.resolve({ data: card }).then(resolve);
        return chain;
      }
      if (table === 'staff_profiles') {
        const chain = fluent({ data: [{ id: 'staff-1', facility_id: 'fac-1' }] });
        ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
        (chain as unknown as PromiseLike<unknown>).then =
          (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'staff-1', facility_id: 'fac-1' }] }).then(resolve);
        return chain;
      }
      // Other anon tables (staff_schedules/schedule_overrides) return null data
      return nullChain();
    });
    // bookings は service role クライアント経由（null データでも動作すること）
    mockServiceFrom.mockImplementation(() => nullChain());
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.size).toBe(0);
    // 予約準備済みの施設として最後まで判定した（早期 return で 0 件になったのではない）
    expect(mockServiceFrom).toHaveBeenCalledWith('bookings');
  });

  // ─── 営業時間・予約準備（2026年10月22日 是正）─────────────────────────────
  // 旧実装はスタッフの勤務と予約だけを見ており、定休日や予約を受けない施設にも「空きあり」を出していた。

  test('定休日（その曜日の business_hours が null）は勤務スタッフがいても空きなし', async () => {
    buildMultiTableMock({
      facility_card_view: [readyCard('fac-1', { business_hours: { ...OPEN_ALL_WEEK, fri: null } })],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01')).has('fac-1')).toBe(false);
    // 定休日でない曜日（2026-05-02 は土曜）は従来どおり空きあり
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-02')).has('fac-1')).toBe(true);
  });

  test('勤務時間は営業時間に切り詰めて判定する（営業時間外の勤務は空きに数えない）', async () => {
    // 勤務 09:00-18:00、営業 13:00-18:00、13:00-18:00 は予約で埋まっている。
    buildMultiTableMock({
      facility_card_view: [readyCard('fac-1', { business_hours: { ...OPEN_ALL_WEEK, fri: { open: '13:00', close: '18:00' } } })],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [{ staff_id: 'staff-1', start_time: '13:00', end_time: '18:00' }],
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01')).has('fac-1')).toBe(false);
  });

  test('午後から営業する日は、午前の検索で空きなし', async () => {
    buildMultiTableMock({
      facility_card_view: [readyCard('fac-1', { business_hours: { ...OPEN_ALL_WEEK, fri: { open: '13:00', close: '20:00' } } })],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'morning')).has('fac-1')).toBe(false);
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01', 'afternoon')).has('fac-1')).toBe(true);
  });

  test('予約準備が整っていない施設（写真なし等）は空きありにしない', async () => {
    buildMultiTableMock({
      facility_card_view: [readyCard('fac-1', { photo_count: 0 })],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.size).toBe(0);
    // 予約を受けない施設しか無ければ、スタッフ・予約は読まない
    expect(mockFrom.mock.calls.map((c) => c[0])).toEqual(['facility_card_view']);
    expect(mockServiceFrom).not.toHaveBeenCalled();
  });

  test('公開されていない施設（view に行が無い）は空きなし', async () => {
    buildMultiTableMock({
      facility_card_view: [],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01')).size).toBe(0);
  });

  test('view の取得結果が null でも例外にせず空きなし', async () => {
    mockFrom.mockImplementation(() => {
      const chain = fluent({ data: null });
      chain.in = jest.fn(() => Promise.resolve({ data: null }));
      return chain;
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01')).size).toBe(0);
  });

  test('施設カードは anon で view から読み、スタッフ・予約は予約準備済みの施設だけで引く', async () => {
    const chains = buildMultiTableMock({
      facility_card_view: [readyCard('fac-1'), readyCard('fac-2', { active_staff_count: 0 })],
      staff_schedules: [{ staff_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
      bookings: [],
    });
    const result = await getAvailableFacilityIds(['fac-1', 'fac-2'], '2026-05-01');
    expect([...result]).toEqual(['fac-1']);
    expect(chains.facility_card_view.select).toHaveBeenCalledWith(
      'id, name, prefecture, city, business_hours, photo_count, booking_menu_count, active_staff_count, has_address',
    );
    expect(chains.facility_card_view.in).toHaveBeenCalledWith('id', ['fac-1', 'fac-2']);
    expect(chains.staff_profiles.in).toHaveBeenCalledWith('facility_id', ['fac-1']);
    expect(chains.bookings.in).toHaveBeenCalledWith('facility_id', ['fac-1']);
  });

  test('予約準備済みでない施設のスタッフが混ざっても数えない', async () => {
    // staff_profiles の facility_id 絞り込みが効かなかった場合でも、空きありに倒さない
    buildMultiTableMock({
      staff_schedules: [{ staff_id: 'staff-x', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 'staff-x', facility_id: 'fac-x' }],
      schedule_overrides: [],
      bookings: [],
    });
    expect((await getAvailableFacilityIds(['fac-1'], '2026-05-01')).size).toBe(0);
  });

  test('日付として読めない値は空集合（DB を読まない）', async () => {
    const result = await getAvailableFacilityIds(['fac-1'], 'not-a-date');
    expect(result.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('facilityOpenWindow（get_available_slots と同じ営業時間の解釈）', () => {
  const WHOLE_DAY = { start: 0, end: 1440 };

  test.each([
    ['未設定(null)', null],
    ['文字列', '10:00〜19:00'],
    ['配列', []],
  ])('business_hours が %s なら制限しない', (_label, hours) => {
    expect(facilityOpenWindow(hours, 5)).toEqual(WHOLE_DAY);
  });

  test('曜日キーが無ければ制限しない', () => {
    expect(facilityOpenWindow({ mon: { open: '10:00', close: '19:00' } }, 5)).toEqual(WHOLE_DAY);
  });

  test('曜日キーが null なら定休日', () => {
    expect(facilityOpenWindow({ fri: null }, 5)).toBeNull();
  });

  test('0 は日曜（sun）を見る', () => {
    expect(facilityOpenWindow({ sun: null, fri: { open: '10:00', close: '19:00' } }, 0)).toBeNull();
  });

  test('open/close を分に直す（1桁の時・秒付きも読める）', () => {
    expect(facilityOpenWindow({ fri: { open: '9:00', close: '18:30:00' } }, 5)).toEqual({ start: 540, end: 1110 });
  });

  test.each([
    ['曜日の値が object でない', 'closed'],
    ['open が文字列でない', { open: 9, close: '18:00' }],
    ['close が無い', { open: '09:00' }],
    ['open の形式が読めない', { open: 'nine', close: '18:00' }],
    ['close の形式が読めない', { open: '09:00', close: 'late' }],
  ])('%s なら制限しない', (_label, day) => {
    expect(facilityOpenWindow({ fri: day }, 5)).toEqual(WHOLE_DAY);
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
    mockServiceFrom.mockReturnValue(chain);
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

  // ─── 複数語キーワードの AND 意味論（2026年8月11日 恒久根治）───────────────
  test('searchFacilities: 複数語は語ごとに .or() を呼ぶ（PostgREST 側で AND 結合される）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ keyword: '豊中 まつげ' });

    const ilikeCalls = ((chain.or as jest.Mock).mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('ilike')
    );
    // 1回にまとめてしまうと `%豊中 まつげ%` の literal 一致に戻り、常に0件になる
    expect(ilikeCalls).toHaveLength(2);
    expect(ilikeCalls[0][0]).toContain('豊中');
    expect(ilikeCalls[0][0]).not.toContain('まつげ');
    expect(ilikeCalls[1][0]).toContain('まつげ');
  });

  test('searchFacilities: 単語1つなら .or() は1回だけ（従来挙動を変えない）', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ keyword: 'まつげ' });
    const ilikeCalls = ((chain.or as jest.Mock).mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('ilike')
    );
    expect(ilikeCalls).toHaveLength(1);
  });

  test('searchFacilities: 空白のみのキーワードでは .or() を1回も呼ばない', async () => {
    const chain = fluent({ data: [], count: 0, error: null });
    mockFrom.mockReturnValue(chain);
    await searchFacilities({ keyword: '   ' });
    const ilikeCalls = ((chain.or as jest.Mock).mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('ilike')
    );
    expect(ilikeCalls).toHaveLength(0);
  });

  // table 名 → チェーンを組み立てる共通ヘルパー（anon/service role どちらの from() にも使う）
  function chainFor(data: unknown[]) {
    const chain = fluent({ data });
    ['in', 'eq'].forEach(m => { chain[m] = jest.fn(() => chain); });
    (chain as unknown as PromiseLike<unknown>).then =
      (resolve: (v: unknown) => unknown) => Promise.resolve({ data }).then(resolve);
    return chain;
  }

  test('getAvailableFacilityIds: 時刻フォーマット h のみ (分なし) も処理する', async () => {
    // timeToMinutes が "10" → h*60 + 0 を返す経路を踏む
    const anonMap: Record<string, unknown[]> = {
      facility_card_view: [readyCard('fac-1')],
      staff_schedules: [{ staff_id: 's-1', start_time: '10', end_time: '11' }],
      staff_profiles: [{ id: 's-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
    };
    mockFrom.mockImplementation((table: string) => chainFor(anonMap[table] ?? []));
    // bookings は service role クライアント経由
    mockServiceFrom.mockImplementation((table: string) => chainFor(table === 'bookings' ? [] : []));
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('getAvailableFacilityIds: bookings.start/end 時刻が end <= start → bookedMinutes=0', async () => {
    // Math.max(0, end-start) の Math.max 分岐をテスト
    const anonMap: Record<string, unknown[]> = {
      facility_card_view: [readyCard('fac-1')],
      staff_schedules: [{ staff_id: 's-1', start_time: '09:00', end_time: '18:00' }],
      staff_profiles: [{ id: 's-1', facility_id: 'fac-1' }],
      schedule_overrides: [],
    };
    mockFrom.mockImplementation((table: string) => chainFor(anonMap[table] ?? []));
    // bookings は service role クライアント経由
    mockServiceFrom.mockImplementation((table: string) =>
      chainFor(table === 'bookings' ? [{ staff_id: 's-1', start_time: '11:00', end_time: '10:00' }] : [])
    );
    const result = await getAvailableFacilityIds(['fac-1'], '2026-05-01');
    expect(result.has('fac-1')).toBe(true);
  });

  test('getMonthlyBookingCounts: 12月は翌年1月を計算', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-12-15T00:00:00Z'));
    const chain = fluent(null);
    chain.lt = jest.fn(() => Promise.resolve({ data: [] }));
    mockServiceFrom.mockReturnValue(chain);
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
    mockServiceFrom.mockReturnValue(chain);
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
