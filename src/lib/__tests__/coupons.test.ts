const mockFrom = jest.fn();
const mockAuthCreator = jest.fn(async () => ({from:mockFrom}));
jest.mock('../supabase-server-auth', () => ({createServerSupabaseAuthClient: () => mockAuthCreator()}));

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getCouponsByFacility, getActiveCouponsByFacility, getCouponMenus, getCouponMenuMap } from '../coupons';

beforeEach(() => {
  mockFrom.mockReset();
  mockAuthCreator.mockClear();
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
  });

  // 【回帰防止・2026年10月22日】管理一覧は無効（is_active=false）のクーポンも返す。
  // is_active で絞ると、「有効」を外して保存したクーポンが一覧から消え、二度と有効に戻せない。
  test('無効なクーポンも返す（is_active で絞らない）', async () => {
    const coupons = [{ id: 'c-1', is_active: true }, { id: 'c-2', is_active: false }];
    const chain = fluent({ data: coupons });
    mockFrom.mockReturnValue(chain);

    const result = await getCouponsByFacility('fac-1');
    expect(result).toEqual(coupons);
    // select と eq は同じ mock なので、is_active への絞り込みが 1 度も無いことだけを見る。
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'fac-1');
    expect(chain.eq.mock.calls.filter((c: unknown[]) => c[0] === 'is_active')).toEqual([]);
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
  test.each([
    ['2026-10-08T14:59:59.999Z', '2026-10-08'],
    ['2026-10-08T15:00:00.000Z', '2026-10-09'],
  ])('施設表示のDATEフィルタはJST境界に揃う: %s', async (now, date) => {
    jest.useFakeTimers(); jest.setSystemTime(new Date(now));
    try {
      const chain = fluent({ data: [] }); mockFrom.mockReturnValue(chain);
      await getActiveCouponsByFacility('fac-1');
      expect(chain.or.mock.calls).toEqual([[`valid_from.is.null,valid_from.lte.${date}`], [`valid_until.is.null,valid_until.gte.${date}`]]);
    } finally { jest.useRealTimers(); }
  });
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

test('owner list uses the authenticated cookie context', async () => { mockFrom.mockReturnValue(fluent({data:[]})); await getCouponsByFacility('fac-1'); expect(mockAuthCreator).toHaveBeenCalledTimes(1); });

test.each([getCouponsByFacility,getActiveCouponsByFacility])('coupon lookup failure is never an empty successful list %#', async read => { mockFrom.mockReturnValue(fluent({data:null,error:{code:'08006',message:'private source'}})); await expect(read('fac-1')).rejects.toThrow('DATABASE_FAILURE:08006'); });

test('coupon-menu lookup failure is never interpreted as applies to all menus', async () => { mockFrom.mockReturnValue({select:()=>({eq:()=>Promise.resolve({data:null,error:{code:'08006'}})})}); await expect(getCouponMenus('c-1')).rejects.toThrow('DATABASE_FAILURE:08006'); });

describe('getCouponMenuMap', () => {
  test('クーポンIDごとに対象メニューIDをまとめる（1クエリ）', async () => {
    const inMock = jest.fn(() => Promise.resolve({ data: [
      { coupon_id: 'c-1', menu_id: 'm-1' }, { coupon_id: 'c-1', menu_id: 'm-2' }, { coupon_id: 'c-2', menu_id: 'm-3' },
    ], error: null }));
    const select = jest.fn(() => ({ in: inMock }));
    mockFrom.mockReturnValue({ select });
    await expect(getCouponMenuMap(['c-1', 'c-2', 'c-3'])).resolves.toEqual({ 'c-1': ['m-1', 'm-2'], 'c-2': ['m-3'] });
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('coupon_menus');
    expect(select).toHaveBeenCalledWith('coupon_id, menu_id');
    expect(inMock).toHaveBeenCalledWith('coupon_id', ['c-1', 'c-2', 'c-3']);
    expect(mockAuthCreator).not.toHaveBeenCalled();
  });

  test('クーポンが無ければ問い合わせない', async () => {
    await expect(getCouponMenuMap([])).resolves.toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('行が無い（null）は空マップ', async () => {
    mockFrom.mockReturnValue({ select: () => ({ in: () => Promise.resolve({ data: null, error: null }) }) });
    await expect(getCouponMenuMap(['c-1'])).resolves.toEqual({});
  });

  test('取得失敗を「対象メニュー無し」に偽装しない', async () => {
    mockFrom.mockReturnValue({ select: () => ({ in: () => Promise.resolve({ data: null, error: { code: '08006' } }) }) });
    await expect(getCouponMenuMap(['c-1'])).rejects.toThrow('DATABASE_FAILURE:08006');
  });
});
