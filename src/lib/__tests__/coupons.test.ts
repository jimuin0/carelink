const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getCouponsByFacility, getActiveCouponsByFacility, getCouponMenus, getCouponsByMenuId, hasCoupons } from '../coupons';

beforeEach(() => {
  mockFrom.mockReset();
});

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  // .or は select/eq と別の mock にする（getCouponsByFacility が期間フィルタを一切
  // 使わないこと＝.or 未呼び出しを、eq 等と区別して検証できるようにする）。
  self.or = jest.fn(() => self);
  self.order = jest.fn(() => Promise.resolve(resolvedValue));
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('getCouponsByFacility', () => {
  test('クーポン一覧を返す', async () => {
    const coupons = [{ id: 'c-1', title: '初回限定' }];
    const chain = fluent({ data: coupons });
    mockFrom.mockReturnValue(chain);

    const result = await getCouponsByFacility('fac-1');
    expect(result).toEqual(coupons);
    expect(mockFrom).toHaveBeenCalledWith('coupons');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'fac-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('データがない場合は空配列', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getCouponsByFacility('fac-1');
    expect(result).toEqual([]);
  });

  // 【退行防止・オーナー管理画面は期間外クーポンも表示すべき】admin/coupons/page.tsx は
  // 期間外（未来開始／期限切れ）のクーポンの編集リンク・利用実績まで出す必要があるため、
  // この関数は valid_from/valid_until の期間フィルタ（.or）を絶対にかけてはならない。
  test('期間フィルタ(.or)をかけない（管理画面用・期間外クーポンも残す）', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);

    await getCouponsByFacility('fac-1');

    expect(chain.or).not.toHaveBeenCalled();
  });
});

describe('getActiveCouponsByFacility', () => {
  test('クーポン一覧を返す', async () => {
    const coupons = [{ id: 'c-1', title: '初回限定' }];
    const chain = fluent({ data: coupons });
    mockFrom.mockReturnValue(chain);

    const result = await getActiveCouponsByFacility('fac-1');
    expect(result).toEqual(coupons);
    expect(mockFrom).toHaveBeenCalledWith('coupons');
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'fac-1');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
  });

  test('データがない場合は空配列', async () => {
    mockFrom.mockReturnValue(fluent({ data: null }));

    const result = await getActiveCouponsByFacility('fac-1');
    expect(result).toEqual([]);
  });

  // 【恒久根治の回帰防止】顧客向けは is_active=true のみでは valid_from 未到来／valid_until
  // 経過済みの期間外クーポンも表示され、選択すると api/booking のサーバー検証で 400 になって
  // いた（表示と予約可否の不整合）。api/liff/coupons と同じ期間フィルタを DB クエリに適用する。
  test('valid_from/valid_until の期間内フィルタをDBクエリに適用する', async () => {
    const chain = fluent({ data: [] });
    mockFrom.mockReturnValue(chain);

    await getActiveCouponsByFacility('fac-1');

    expect(chain.or).toHaveBeenCalledWith(expect.stringMatching(/^valid_from\.is\.null,valid_from\.lte\./));
    expect(chain.or).toHaveBeenCalledWith(expect.stringMatching(/^valid_until\.is\.null,valid_until\.gte\./));
  });
});

describe('getCouponMenus', () => {
  test('クーポンメニュー一覧を返す', async () => {
    const menus = [{ id: 'cm-1', coupon_id: 'c-1', menu_id: 'm-1' }];
    const chain = fluent(null);
    // getCouponMenus: select→eq → terminal (no order/single)
    chain.eq = jest.fn(() => Promise.resolve({ data: menus }));
    mockFrom.mockReturnValue(chain);

    const result = await getCouponMenus('c-1');
    expect(result).toEqual(menus);
    expect(mockFrom).toHaveBeenCalledWith('coupon_menus');
  });

  test('データがない場合は空配列', async () => {
    const chain = fluent(null);
    chain.eq = jest.fn(() => Promise.resolve({ data: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getCouponMenus('c-1');
    expect(result).toEqual([]);
  });
});

describe('getCouponsByMenuId', () => {
  test('アクティブなクーポンのみ返す', async () => {
    const data = [
      { coupon_id: 'c-1', coupons: { id: 'c-1', title: '初回限定', is_active: true } },
      { coupon_id: 'c-2', coupons: { id: 'c-2', title: '期限切れ', is_active: false } },
    ];
    const chain = fluent(null);
    chain.eq = jest.fn(() => Promise.resolve({ data }));
    mockFrom.mockReturnValue(chain);

    const result = await getCouponsByMenuId('m-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c-1');
  });

  test('データがない場合は空配列', async () => {
    const chain = fluent(null);
    chain.eq = jest.fn(() => Promise.resolve({ data: null }));
    mockFrom.mockReturnValue(chain);

    const result = await getCouponsByMenuId('m-1');
    expect(result).toEqual([]);
  });

  test('coupons が配列形式 (joined relation as array) でも処理する', async () => {
    const data = [
      { coupon_id: 'c-1', coupons: [{ id: 'c-1', title: 'arr-form', is_active: true }] },
    ];
    const chain = fluent(null);
    chain.eq = jest.fn(() => Promise.resolve({ data }));
    mockFrom.mockReturnValue(chain);
    const result = await getCouponsByMenuId('m-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c-1');
  });

  test('coupons が null の行はスキップする', async () => {
    const data = [
      { coupon_id: 'c-1', coupons: null },
      { coupon_id: 'c-2', coupons: { id: 'c-2', title: 'ok', is_active: true } },
    ];
    const chain = fluent(null);
    chain.eq = jest.fn(() => Promise.resolve({ data }));
    mockFrom.mockReturnValue(chain);
    const result = await getCouponsByMenuId('m-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c-2');
  });
});

describe('hasCoupons', () => {
  function hasCouponChain(count: number | null) {
    // hasCoupons: from→select→eq('facility_id')→eq('is_active') where last eq is terminal
    const p = Promise.resolve({ count });
    const secondEq = jest.fn(() => p);
    const firstEqResult = { eq: secondEq, then: p.then.bind(p) };
    const chain = fluent(null);
    chain.eq = jest.fn(() => firstEqResult);
    return chain;
  }

  test('クーポンがある場合はtrue', async () => {
    mockFrom.mockReturnValue(hasCouponChain(3));
    const result = await hasCoupons('fac-1');
    expect(result).toBe(true);
  });

  test('クーポンがない場合はfalse', async () => {
    mockFrom.mockReturnValue(hasCouponChain(0));
    const result = await hasCoupons('fac-1');
    expect(result).toBe(false);
  });

  test('countがnullの場合はfalse', async () => {
    mockFrom.mockReturnValue(hasCouponChain(null));
    const result = await hasCoupons('fac-1');
    expect(result).toBe(false);
  });
});
