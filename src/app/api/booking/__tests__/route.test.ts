/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  bookingRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({
  sendBookingConfirmation: jest.fn(() => Promise.resolve()),
  sendNewBookingNotification: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/push', () => ({
  sendPushToFacilityOwners: jest.fn(() => Promise.resolve()),
  sendPushToUser: jest.fn(() => Promise.resolve()),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/line', () => ({
  sendBookingConfirmation: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('@/lib/integrations/line-works', () => ({
  isLineWorksConfigured: jest.fn(() => false),
  notifyNewBookingLineWorks: jest.fn(),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));
// Service-role client (createServiceRoleClient) must share mockFrom so CAS tests work
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    })),
  }),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

// Dynamic date: 6 months in the future (always within the 1-year booking limit)
function futureBookingDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  // Default: RPC succeeds
  mockRpc.mockResolvedValue({ data: 'new-booking-id', error: null });
});

const FUTURE_DATE = futureBookingDate();

const validBooking = {
  facility_id: '123e4567-e89b-12d3-a456-426614174000',
  staff_id: null,
  menu_id: null,
  coupon_id: null,
  booking_date: FUTURE_DATE,
  start_time: '10:00',
  end_time: '11:00',
  customer_name: 'テスト太郎',
  email: 'test@example.com',
  total_price: 5000,
  points_used: 0,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

// Fluent Supabase chain builder.
// Returns a chainable object; the terminal call (single / maybeSingle / the last chainable method)
// resolves to `resolvedValue`.
function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.insert = handler;
  self.update = handler;
  self.delete = handler;
  self.eq = handler;
  self.neq = handler;
  self.not = handler;
  self.lt = handler;
  self.gt = handler;
  self.gte = handler;
  self.lte = handler;
  self.in = handler;
  self.limit = handler;
  self.maybeSingle = jest.fn(() => Promise.resolve(resolvedValue));
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

// Route call sequence (no menu/coupon/staff/points):
// call 1: conflict check   (bookings select)
// call 2: facility_profiles (auto-confirm setting)
// then: supabase.rpc('create_booking_atomic')
// subsequent calls: notification lookups (all in try/catch — failures are suppressed)

describe('POST /api/booking', () => {
  test('正常に予約を作成する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain; // conflict check
      return nullChain;                         // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('new-booking-id');
  });

  test('バリデーション失敗→400', async () => {
    const res = await POST(makeRequest({ ...validBooking, customer_name: '' }));
    expect(res.status).toBe(400);
  });

  test('開始時間>=終了時間→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, start_time: '11:00', end_time: '10:00' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('開始時間');
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(429);
  });

  test('staff_id指定時の競合→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    // After eq(staff_id) the chain resolves with a conflict
    const conflictResult = Promise.resolve({ data: [{ id: 'existing' }] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => conflictResult);
    chainEnd.then = conflictResult.then.bind(conflictResult);
    conflictChain.gt = jest.fn(() => chainEnd);

    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, staff_id: staffId }));
    expect(res.status).toBe(409);
  });

  test('DB挿入失敗→500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'db error', code: '99999' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('DB制約違反（23505）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'BOOKING_CONFLICT duplicate', code: '23505' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('確定層ゲート: 時間帯停止(SUSPENDED)→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => { callNum++; return callNum === 1 ? conflictChain : nullChain; });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'SUSPENDED: この時間帯はネット予約の受付を停止しています' } });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('停止');
  });

  test('確定層ゲート: 日別受付上限(CAPACITY_FULL)→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => { callNum++; return callNum === 1 ? conflictChain : nullChain; });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'CAPACITY_FULL: 本日のネット予約受付は上限に達しました' } });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('上限');
  });

  test('ポイント残高不足→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const pointsChain = fluent(null);
    pointsChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 100 }] }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain; // conflict check
      return pointsChain;                       // user_points balance (100 < 500 → insufficient)
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 500 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('ポイント');
  });

  test('未認証ユーザーがポイント利用→401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, points_used: 100 }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証');
  });

  test('menu_idありでサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';

    // Route call order with menu_id:
    // 1: conflict check (bookings)
    // 2: facility_menus price lookup — returns { data: [{ id: menuId, price: 8000 }] }
    // 3: facility_profiles (auto-confirm)
    // rpc: create_booking_atomic → success
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_menus lookup: the route uses .in('id', [...]).eq('facility_id', ...)
    // fluent() chains resolve through single() or maybeSingle(); for this query the
    // route uses await directly on the chain object, so we need a thenable
    const menuLookupResult = { data: [{ id: menuId, price: 8000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuLookupResult));
    menuChain.then = Promise.resolve(menuLookupResult).then.bind(Promise.resolve(menuLookupResult));

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain; // conflict check
      if (callNum === 2) return menuChain;     // facility_menus price lookup
      return nullChain;                        // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8000 })
    );
  });

  test('coupon_id + percentage割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    // Route call order with menu_id + coupon_id:
    // 1: conflict check (bookings)
    // 2: facility_menus price lookup → price: 10000
    // 3: coupons discount lookup → 20% off → 8000
    // 4: facility_profiles (auto-confirm)
    // rpc: create_booking_atomic with total_price: 8000
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'percentage', discount_value: 20, is_active: true, valid_from: null, valid_until: null }, error: null });

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;  // conflict check
      if (callNum === 2) return menuChain;      // facility_menus lookup
      if (callNum === 3) return couponChain;    // coupons discount lookup
      return nullChain;                         // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8000 })
    );
  });

  test('ポイント競合→rollback→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    // Route call order with points_used > 0 and user:
    // 1: conflict check → ok
    // 2: user_points balance check → 200 (sufficient for 150)
    // 3: facility_profiles (auto-confirm)
    // rpc: returns booking-race-1
    // 4: user_points insert (deduction) → deductionRow.id = 'deduction-1'
    // 5: user_points select re-verify → balance -50 (race detected)
    // 6: user_points delete deduction row
    // 7: bookings update cancel
    // → return 400 with "競合"

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 200 }] }));

    const nullChain = fluent({ data: null });

    // Point deduction insert chain: .insert().select('id').single()
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-1' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -50 }] }));

    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-race-1', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;   // conflict check (bookings)
      if (callNum === 2) return balanceChain;    // user_points balance snapshot
      if (callNum === 3) return nullChain;       // facility_profiles (auto-confirm)
      // After RPC success:
      if (table === 'user_points' && callNum === 4) return deductionChain; // insert deduction
      if (table === 'user_points' && callNum === 5) return recheckChain;   // re-verify balance
      if (table === 'user_points') return deleteChain;                     // rollback deduction
      if (table === 'bookings') return cancelChain;                        // cancel booking
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 150 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  test('create_booking_atomic がnullを返す→500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('coupon fixed割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1500, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8500 })
    );
  });

  test('coupon special_price割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'special_price', discount_value: 3000, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 3000 })
    );
  });

  // round3 #04/#05: special_price は special_price 列に入る本番形/値欠落クーポンの扱い
  const MENU_ID = '323e4567-e89b-12d3-a456-426614174000';
  const COUPON_ID = '423e4567-e89b-12d3-a456-426614174000';
  function setupCoupon(couponData: Record<string, unknown>) {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const menuResult = { data: [{ id: MENU_ID, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler; menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));
    const couponChain = fluent({ data: { is_active: true, valid_from: null, valid_until: null, ...couponData } });
    const nullChain = fluent({ data: null });
    let n = 0;
    mockFrom.mockImplementation(() => { n++; if (n === 1) return conflictChain; if (n === 2) return menuChain; if (n === 3) return couponChain; return nullChain; });
  }

  test('coupon special_price は special_price 列を採用（本番形・discount_value=null）', async () => {
    setupCoupon({ discount_type: 'special_price', special_price: 3000, discount_value: null });
    const res = await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }));
    expect((await res.json()).success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_total_price: 3000 }));
  });

  test('coupon special_price で special_price/discount_value とも null → 400（不正設定）', async () => {
    setupCoupon({ discount_type: 'special_price', special_price: null, discount_value: null });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(400);
  });

  test('coupon percentage で discount_value null → 400（NaN価格を防止）', async () => {
    setupCoupon({ discount_type: 'percentage', discount_value: null });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(400);
  });

  test('coupon fixed で discount_value null → 400', async () => {
    setupCoupon({ discount_type: 'fixed', discount_value: null });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(400);
  });

  // round4 #A/#B: クーポン適用条件のサーバ検証（メニュー限定・対象者限定）
  // 呼び出し順: 1 conflict / 2 facility_menus / 3 coupons / 4 coupon_menus / 5 bookings履歴(種別限定時のみ)
  function setupCouponEligibility(opts: {
    coupon?: Record<string, unknown>;
    cmRows?: unknown; cmError?: boolean;
    histRows?: unknown; histError?: boolean;
    user?: { id: string } | null;
  }) {
    mockGetUser.mockResolvedValue({ data: { user: opts.user ?? null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const menuResult = { data: [{ id: MENU_ID, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler; menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));
    const couponChain = fluent({ data: { is_active: true, valid_from: null, valid_until: null, coupon_type: 'all', discount_type: 'fixed', discount_value: 0, ...opts.coupon } });
    // coupon_menus: .select('menu_id').eq('coupon_id') が終端
    const cmResolved = opts.cmError ? { data: null, error: { message: 'cm error' } } : { data: opts.cmRows ?? null, error: null };
    const cmChain: Record<string, unknown> = {};
    cmChain.select = jest.fn(() => cmChain);
    cmChain.eq = jest.fn(() => Promise.resolve(cmResolved));
    // bookings 履歴: .select('id').eq(facility).not(status).eq(key).limit(1) が終端
    const histResolved = opts.histError ? { data: null, error: { message: 'hist error' } } : { data: opts.histRows ?? null, error: null };
    const histChain: Record<string, unknown> = {};
    const histHandler = jest.fn(() => histChain);
    histChain.select = histHandler; histChain.eq = histHandler; histChain.not = histHandler;
    histChain.limit = jest.fn(() => Promise.resolve(histResolved));
    const usesHistory = opts.coupon?.coupon_type === 'new_customer' || opts.coupon?.coupon_type === 'repeat';
    const nullChain = fluent({ data: null });
    let n = 0;
    mockFrom.mockImplementation(() => {
      n++;
      if (n === 1) return conflictChain;
      if (n === 2) return menuChain;
      if (n === 3) return couponChain;
      if (n === 4) return cmChain;
      if (n === 5 && usesHistory) return histChain; // 種別限定時のみ履歴照合（call5）
      return nullChain;
    });
  }
  const OTHER_MENU = '999e4567-e89b-12d3-a456-426614174999';

  test('#A メニュー限定クーポンを対象メニューに適用→成功', async () => {
    setupCouponEligibility({ cmRows: [{ menu_id: MENU_ID }] });
    const res = await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }));
    expect((await res.json()).success).toBe(true);
  });

  test('#A メニュー限定クーポンを対象外メニューに適用→400', async () => {
    setupCouponEligibility({ cmRows: [{ menu_id: OTHER_MENU }] });
    const res = await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('メニュー');
  });

  test('#A coupon_menus 取得エラー→500', async () => {
    setupCouponEligibility({ cmError: true });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(500);
  });

  test('#B new_customer クーポン + 来店履歴あり→400', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'new_customer' }, histRows: [{ id: 'past' }] });
    const res = await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('新規');
  });

  test('#B new_customer クーポン + 履歴なし→成功', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'new_customer' }, histRows: [] });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).not.toBe(400);
  });

  test('#B repeat クーポン + 履歴なし(null)→400', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'repeat' }, histRows: null });
    const res = await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('履歴');
  });

  test('#B repeat クーポン + 来店履歴あり→成功', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'repeat' }, histRows: [{ id: 'past' }] });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).not.toBe(400);
  });

  test('#B 履歴取得エラー→500', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'new_customer' }, histError: true });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(500);
  });

  test('#B ログインユーザーは user_id で履歴判定（new_customer + 履歴あり→400）', async () => {
    setupCouponEligibility({ coupon: { coupon_type: 'new_customer' }, histRows: [{ id: 'past' }], user: { id: 'user-xyz' } });
    expect((await POST(makeRequest({ ...validBooking, menu_id: MENU_ID, coupon_id: COUPON_ID }))).status).toBe(400);
  });

  test('確定層ゲート: 非公開施設(FACILITY_NOT_BOOKABLE)→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let n = 0;
    mockFrom.mockImplementation(() => { n++; return n === 1 ? conflictChain : nullChain; });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'FACILITY_NOT_BOOKABLE: この施設は現在ネット予約を受け付けていません' } });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('受け付けていません');
  });

  test('無効クーポン→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Inactive coupon
    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 500, is_active: false, valid_from: null, valid_until: null } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('クーポン');
  });

  test('期限切れクーポン→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Expired coupon (valid_until in the past)
    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 500, is_active: true, valid_from: null, valid_until: '2020-01-01T00:00:00Z' } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
  });

  test('回帰: valid_until が当日のDATE文字列(YYYY-MM-DD)でも有効（#2 当日無効化バグ修正）', async () => {
    const { getTodayString } = require('@/lib/validations-booking');
    const today = getTodayString(); // JST 'YYYY-MM-DD'
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler; menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));
    // valid_from/valid_until を DATE 列の実戻り値('YYYY-MM-DD')で再現。当日が期限 → 当日中は有効であるべき
    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 500, is_active: true, valid_from: today, valid_until: today } });
    let callNum = 0;
    mockFrom.mockImplementation(() => { callNum++; if (callNum === 1) return conflictChain; if (callNum === 2) return menuChain; if (callNum === 3) return couponChain; return fluent({ data: null }); });
    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).not.toBe(400);
    expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_total_price: 9500 }));
  });

  test('無効メニュー（facility不一致）→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const wrongMenuId = '999e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // Returns wrongMenuId, not the requested menuId
    const menuResult = { data: [{ id: wrongMenuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    mockFrom.mockImplementation((_, callN = { n: 0 }) => {
      void callN;
      return menuChain;
    });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
  });

  test('staff_id指定時に指名料を加算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    // staff_id is present → route chains .eq('staff_id', ...) after .gt(), so gt must return chainable
    const conflictChain = fluent(null);
    const noConflict = Promise.resolve({ data: [] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const menuResult = { data: [{ id: menuId, price: 8000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Staff nomination fee chain
    const staffChain = fluent({ data: { nomination_fee: 500 } });

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return staffChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8500 })
    );
  });

  test('menu_idsで複数メニュー価格を合計', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId1 = '323e4567-e89b-12d3-a456-426614174001';
    const menuId2 = '323e4567-e89b-12d3-a456-426614174002';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId1, price: 3000 }, { id: menuId2, price: 2000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return nullChain;
    });

    const body = { ...validBooking, menu_ids: [menuId1, menuId2] };
    const res = await POST(makeRequest(body));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 5000 })
    );
  });

  test('ポイント成功（CAS通過）→200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-2' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-ok' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 350 }] })); // still positive

    mockRpc.mockResolvedValue({ data: 'booking-cas-ok', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return balanceChain;
      if (callNum === 3) return nullChain;
      if (table === 'user_points' && callNum === 4) return deductionChain;
      if (table === 'user_points' && callNum === 5) return recheckChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 150 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('booking-cas-ok');
  });

  test('LINE Works通知パス（isLineWorksConfigured=true）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(true);

    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // staffList with a LINE Works channel
    const staffListChain: Record<string, unknown> = {};
    const staffListResult = { data: [{ id: 'staff-lw', line_works_channel_id: 'ch-1', line_works_notify_all: true }] };
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));
    staffListChain.then = Promise.resolve(staffListResult).then.bind(Promise.resolve(staffListResult));

    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return nullChain;       // facility_profiles auto-confirm
      if (callNum === 3) return staffListChain;  // staff_profiles LINE Works lookup
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    // Restore
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('競合あり（スタッフなし）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [{ id: 'conflict-booking' }] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('BOOKING_CONFLICT in error message (no 23505 code) → 409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'BOOKING_CONFLICT occurred', code: '99998' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('認証済みユーザーの予約 → ユーザーへのプッシュ通知', async () => {
    const { sendPushToUser } = require('@/lib/push');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-push-test' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: 'booking-push-test', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendPushToUser).toHaveBeenCalledWith('user-push-test', expect.objectContaining({ title: expect.any(String) }));
  });

  test('オーナーメール通知パス（owner_idあり、email取得）', async () => {
    const { sendNewBookingNotification } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_profiles (auto-confirm) - null
    // facility_members (owner) - returns owner data
    // profiles (owner email) - returns email
    const nullChain = fluent({ data: null });
    const ownerChain = fluent({ data: { user_id: 'owner-id-1' } });
    const ownerEmailChain = fluent({ data: { email: 'owner@example.com' } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return nullChain; // facility_profiles (auto-confirm)
      // email lookups: facility_profiles, facility_menus, staff_profiles, facility_members
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return ownerEmailChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: 'booking-owner-test', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendNewBookingNotification).toHaveBeenCalled();
  });

  test('LINE通知パス（user + LINE_CHANNEL_ACCESS_TOKEN_CARELINK + lineLink）', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-test' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_profiles → auto-confirm
    const nullChain = fluent({ data: null });

    // line_user_links → lineLink with line_user_id
    const lineLinkChain = fluent({ data: { line_user_id: 'line-user-abc' } });

    // call order:
    // 1: conflict check
    // 2: facility_profiles (auto-confirm)
    // 3: facility_profiles (email Promise.all)
    // 4: facility_members (email Promise.all)
    // 5: line_user_links (LINE notification)
    // 6: facility_profiles (LINE facility name)
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 5) return lineLinkChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE Works ループ（proper call ordering、staffList複数エントリ）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(undefined);

    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: 'booking-lw-test', error: null });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const nullChain = fluent({ data: null });

    // staffList with mixed entries: null channel_id (skip), notify_all=false (skip), notify_all=true (notify)
    const staffListResult = {
      data: [
        { id: 'staff-a', line_works_channel_id: null, line_works_notify_all: false },
        { id: 'staff-b', line_works_channel_id: 'ch-b', line_works_notify_all: false },
        { id: 'staff-c', line_works_channel_id: 'ch-c', line_works_notify_all: true },
      ],
    };
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));

    // call order (user=null, no menu):
    // 1: conflict check
    // 2: facility_profiles (auto-confirm)
    // 3: facility_profiles (email Promise.all)
    // 4: facility_members (email Promise.all)
    // 5: staff_profiles (LINE Works staffList)
    // 6: facility_profiles (LINE Works Promise.all)
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 5) return staffListChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(notifyNewBookingLineWorks).toHaveBeenCalledWith('ch-c', expect.any(Object));
    expect(notifyNewBookingLineWorks).not.toHaveBeenCalledWith('ch-b', expect.any(Object));

    isLineWorksConfigured.mockReturnValue(false);
  });

  test('オーナーemailなし → sendNewBookingNotification 呼ばれない', async () => {
    const { sendNewBookingNotification } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    // owner has user_id but profiles returns no email
    const ownerChain = fluent({ data: { user_id: 'owner-1' } });
    const noEmailChain = fluent({ data: { email: null } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return nullChain;    // facility_profiles auto-confirm
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return noEmailChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: 'booking-no-email', error: null });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    expect(sendNewBookingNotification).not.toHaveBeenCalled();
  });

  test('booking_auto_confirm=true→confirmed status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_profiles returns booking_auto_confirm: true
    const facilityChain = fluent({ data: { booking_auto_confirm: true } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return facilityChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_status: 'confirmed' })
    );
  });

  test('sendPushToFacilityOwners が reject → .catch() → Sentry', async () => {
    const { sendPushToFacilityOwners } = require('@/lib/push');
    sendPushToFacilityOwners.mockReturnValue(Promise.reject(new Error('push failed')));

    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation(() => fluent({ data: null }));
    // override call 1
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
  });

  test('sendPushToUser が reject → .catch() → Sentry', async () => {
    const { sendPushToFacilityOwners, sendPushToUser } = require('@/lib/push');
    sendPushToFacilityOwners.mockResolvedValue(undefined);
    sendPushToUser.mockReturnValue(Promise.reject(new Error('user push failed')));

    mockGetUser.mockResolvedValue({ data: { user: { id: 'push-user' } } });
    let callNum = 0;
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
  });

  test('LINE通知: menu_id あり → facility_menus からメニュー名を取得', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-menu' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const MENU_UUID = '11111111-1111-1111-a111-111111111111';
    const bookingWithMenu = { ...validBooking, menu_id: MENU_UUID };

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // Call sequence with menu_id:
    // 1: bookings (conflict), 2: facility_menus (price check - .in().eq() chain)
    // 3: facility_profiles (auto-confirm), rpc
    // 4: facility_profiles (email), 5: facility_menus (email name lookup)
    // 6: facility_members (owner), 7: line_user_links (LINE via adminSupabase)
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2 && table === 'facility_menus') {
        // Price validation: .select().in().eq() must resolve to { data: [{ id, price }] }
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [{ id: MENU_UUID, price: 5000 }], error: null }),
        };
      }
      if (callNum === 7) return fluent({ data: { line_user_id: 'U_line_menu' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(bookingWithMenu));
    expect(res.status).toBe(200);
    expect(sendLineConfirm).toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知: sendLineBookingConfirm が reject → Sentry', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    sendLineConfirm.mockReturnValue(Promise.reject(new Error('LINE send failed')));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-err' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 5) return fluent({ data: { line_user_id: 'U_line_err' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE Works: notifyNewBookingLineWorks が reject → Sentry', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockReturnValue(Promise.reject(new Error('LW failed')));

    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve({
      data: [{ id: 'staff-lw', line_works_channel_id: 'ch-lw-rej', line_works_notify_all: true }],
    }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 5) return staffListChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('予期しない例外 → 500', async () => {
    mockGetUser.mockImplementation(() => { throw new Error('unexpected'); });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('CAS失敗（残高が負）→ rollback → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-cas' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));
    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-cas' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -50 }] }));

    const rollbackPointsChain: Record<string, unknown> = {};
    rollbackPointsChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    const rollbackBookingChain: Record<string, unknown> = {};
    rollbackBookingChain.update = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    mockRpc.mockResolvedValue({ data: 'booking-cas-fail', error: null });

    let upCall = 0;
    mockFrom.mockImplementation((table: string) => {
      upCall++;
      if (upCall === 1) return conflictChain;
      if (upCall === 2) return balanceChain;
      if (upCall === 3) return nullChain;
      if (table === 'user_points' && upCall === 4) return deductionChain;
      if (table === 'user_points' && upCall === 5) return recheckChain;
      if (table === 'user_points') return rollbackPointsChain;
      if (table === 'bookings') return rollbackBookingChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 150 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  test('rpc が null データで成功 → 500 (newBookingId 空)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    let cc = 0;
    mockFrom.mockImplementation(() => {
      cc++;
      if (cc === 1) return conflictChain;
      return fluent({ data: null });
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('menu_id null かつ menu_ids なし → サーバー側価格計算スキップ', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return fluent({ data: null });
    });
    const res = await POST(makeRequest({ ...validBooking, menu_id: null }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: null })
    );
  });

  // Branch coverage: line 94 - menuRows が null → validIds = new Set([]) → allValid = false → 400
  test('facility_menus returns null → メニュー不正→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: null, error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
  });

  // Branch coverage: line 100 - r.price ?? 0 の null branch（price が null → 0 として集計）
  test('menu price が null → 0 として集計し total=0', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: null }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 0 })
    );
  });

  // Branch coverage: line 115 - valid_from が未来 → coupon 無効 → 400
  test('クーポン valid_from が未来 → 無効として400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();
    const couponId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // valid_from は未来 → まだ有効期間に入っていない
    const couponChain = fluent({
      data: {
        discount_type: 'fixed',
        discount_value: 500,
        is_active: true,
        valid_from: new Date(Date.now() + 86400000 * 30).toISOString(),
        valid_until: null,
      }
    });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('クーポン');
  });

  // Branch coverage: line 162 - serverTotalPrice != null && pointsUsed > 0 → finalPrice を差し引き計算
  test('ポイント使用時に serverTotalPrice から差し引いた finalPrice を RPC に渡す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-final' } } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 1000 }] }));

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-final' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    mockRpc.mockResolvedValue({ data: 'booking-final-price', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return fluent({ data: null }); // facility_profiles
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 500 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    // serverTotalPrice=5000, pointsUsed=500 → finalPrice=4500
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 4500, p_points_used: 500 })
    );
  });

  // Branch coverage: line 236 - deductionRow?.id が falsy → delete スキップして booking をキャンセル
  test('CAS失敗でdeductionRow.idなし → deleteスキップしてbookingロールバック→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-no-did' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    // Deduction insert returns data: null (no id)
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: null })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-no-did', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return balanceChain;
      if (callNum === 3) return nullChain;
      if (table === 'user_points' && callNum === 4) return deductionChain;
      if (table === 'user_points' && callNum === 5) return recheckChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 200 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  // Branch coverage: line 238 - rollbackPointsErr がある場合 console.error ログ
  test('CAS失敗でポイントrollbackエラー → console.error ログ出力', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-rb-err' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-err-id' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    // delete returns an error
    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })),
    }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-rb-err', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return balanceChain;
      if (callNum === 3) return nullChain;
      if (table === 'user_points' && callNum === 4) return deductionChain;
      if (table === 'user_points' && callNum === 5) return recheckChain;
      if (table === 'user_points') return deleteChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 200 }));
    expect(res.status).toBe(400);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[booking] point deduction rollback failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 242 - rollbackBookingErr がある場合 console.error ログ
  test('CAS失敗でbooking rollbackエラー → console.error ログ出力', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-bk-rb-err' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-bk-err' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    // booking update returns error
    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: { message: 'cancel failed' } })),
    }));

    mockRpc.mockResolvedValue({ data: 'booking-bk-err', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return balanceChain;
      if (callNum === 3) return nullChain;
      if (table === 'user_points' && callNum === 4) return deductionChain;
      if (table === 'user_points' && callNum === 5) return recheckChain;
      if (table === 'user_points') return deleteChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 200 }));
    expect(res.status).toBe(400);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[booking] booking rollback failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 155 - pointRows が null → ?? [] → reduce で 0 → 残高不足チェック
  test('user_points クエリが null → ポイント残高 0 → points_used を超えるので400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-null-pts' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // user_points returns { data: null } → (null ?? []).reduce(...) = 0 < 200 → 400
    const pointsNullChain = fluent(null);
    pointsNullChain.eq = jest.fn(() => Promise.resolve({ data: null }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      return pointsNullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 200 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('ポイント');
  });

  // Branch coverage: line 232 - recheck が null → ?? [] → reduce で 0 → newBalance=0 >= 0 → CAS通過
  test('CAS recheck が null → 残高 0 → CAS通過 → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-recheck-null' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 200 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-recheck-null' } })),
      })),
    }));

    // recheck returns { data: null } → (null ?? []) = [] → reduce = 0 → newBalance=0 >= 0 → no rollback
    const recheckNullChain = fluent(null);
    recheckNullChain.eq = jest.fn(() => Promise.resolve({ data: null }));

    mockRpc.mockResolvedValue({ data: 'booking-recheck-null', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return balanceChain;
      if (callNum === 3) return nullChain; // facility_profiles
      if (table === 'user_points' && callNum === 4) return deductionChain;
      if (table === 'user_points' && callNum === 5) return recheckNullChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 150 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('booking-recheck-null');
  });

  // Branch coverage: line 317, 355, 358 - LINE Works: menu_id + staff_id (isAssigned=true) → Promise.all でメニュー名・スタッフ名を取得
  test('LINE Works: menu_id + staff_id あり → assigned staff へ通知', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(undefined);

    const menuId = crypto.randomUUID();
    const staffId = crypto.randomUUID();

    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: 'booking-lw-assigned', error: null });

    // staff_id → conflict chain needs extra .eq() after .gt()
    const noConflict = Promise.resolve({ data: [] });
    const conflictChain = fluent(null);
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const menuResult = { data: [{ id: menuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Staff nomination fee (null → skip addition)
    const staffFeeChain = fluent({ data: { nomination_fee: null } });
    const nullChain = fluent({ data: null });

    // staffList: assigned staff (notify_all=false, isAssigned=true)
    const staffListResult = {
      data: [{ id: staffId, line_works_channel_id: 'ch-assigned', line_works_notify_all: false }],
    };
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));

    // call order (user=null, menu_id, staff_id):
    // 1: conflict, 2: facility_menus (price), 3: staff_profiles (fee),
    // 4: facility_profiles (auto-confirm), rpc
    // notification: 5+, LINE Works staffList at call 9
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return staffFeeChain;
      if (callNum === 4) return nullChain;
      if (callNum === 9) return staffListChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    // isAssigned=true → notified
    expect(notifyNewBookingLineWorks).toHaveBeenCalledWith('ch-assigned', expect.any(Object));

    isLineWorksConfigured.mockReturnValue(false);
  });

  // Branch coverage: discount_type が既知のいずれでもない → 割引なし → total_price そのまま → 200
  test('coupon discount_type が未知の値 → 割引なし → total_price そのまま → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();
    const couponId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = jest.fn(() => Promise.resolve(menuResult));
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // discount_type = 'mystery' → no if/else branch matches → price unchanged
    const couponChain = fluent({ data: { discount_type: 'mystery', discount_value: 0, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 10000 })
    );
  });

  // Branch coverage: LINE通知 → lineLink が存在するが line_user_id が null → 通知スキップ → 200
  test('LINE通知: lineLink あり + line_user_id が null → 通知スキップ → 200', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-no-id' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const nullChain = fluent({ data: null });

    // line_user_links → lineLink exists but line_user_id is null → lineLink?.line_user_id is falsy → skip
    const lineLinkChain = fluent({ data: { line_user_id: null } });

    // call order (user set, no menu):
    // 1: conflict check
    // 2: facility_profiles (auto-confirm)
    // 3: facility_profiles (email Promise.all)
    // 4: facility_members (email Promise.all)
    // 5: line_user_links (LINE notification)
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 5) return lineLinkChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).not.toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });
});
