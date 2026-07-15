/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/coupons
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention via facility_id query param)
 *   - discount_type enum validation
 *   - percentage discount_value > 100 → 400 (Zod refine)
 *   - coupon_type enum validation
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/coupons');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/coupons');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validPostBody(overrides: object = {}) {
  return {
    name: 'テストクーポン',
    discount_type: 'fixed',
    discount_value: 500,
    coupon_type: 'all',
    ...overrides,
  };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: facility_id なし → 401', async () => {
  const res = await GET(makeGetRequest(null));
  expect(res.status).toBe(401);
});

test('GET: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: 正常取得 → 200 with coupons', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([{ id: 'aaa' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.coupons).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(401);
});

test('POST: 不正な discount_type → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ discount_type: 'percent' })));
  expect(res.status).toBe(400);
});

test('POST: 不正な coupon_type → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ coupon_type: 'vip' })));
  expect(res.status).toBe(400);
});

test('POST: percentage で discount_value が 101 → 400 (refine)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ discount_type: 'percentage', discount_value: 101 })));
  expect(res.status).toBe(400);
});

test('POST: percentage で discount_value が 100 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makePostRequest(validPostBody({ discount_type: 'percentage', discount_value: 100 })));
  expect(res.status).toBe(201);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with coupon', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストクーポン' }));
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.coupon).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: discount_type=fixed で discount_value が 100000 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makePostRequest(validPostBody({ discount_value: 100000 })));
  expect(res.status).toBe(201);
});

test('POST: coupon_type=new_customer → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makePostRequest(validPostBody({ coupon_type: 'new_customer' })));
  expect(res.status).toBe(201);
});

test('POST: name が 1文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makePostRequest(validPostBody({ name: 'A' })));
  expect(res.status).toBe(201);
});

test('POST: name が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ name: '' })));
  expect(res.status).toBe(400);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストクーポン' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makePostRequest(validPostBody()));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('GET: DB エラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/coupons');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const res = await POST(makePostRequest(validPostBody(), 'bad-uuid'));
  expect(res.status).toBe(401);
});

test('POST: is_active が明示的に false → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', is_active: false }));
  const res = await POST(makePostRequest(validPostBody({ is_active: false })));
  expect(res.status).toBe(201);
});

test('POST: レスポンスが { coupon: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストクーポン' }));
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(json.coupon).toBeDefined();
  expect(json.coupon.id).toBe('aaa');
});

// ─── 【2026年7月15日 HPB準拠仕様】zod強化＝discount_type×値の相互必須 ─────────────
// 従来は fixed+discount_value null（0円引き扱い）等が作成できてしまっていた（金銭バグの根本原因）。
describe('POST: discount_type×値の相互必須（型×値の全組合せ境界）', () => {
  function setupCreatable() {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  }

  test.each([
    // [discount_type, discount_value, special_price, 期待status]
    ['fixed', null, null, 400],        // 0円引きクーポン（旧実装は201で作成できた）
    ['fixed', 0, null, 400],           // 0円引き明示
    ['fixed', 1, null, 201],           // 下限
    ['fixed', 100000, null, 201],      // 上限
    ['fixed', 100001, null, 400],      // 上限超過
    ['percentage', null, null, 400],   // 0%OFF扱い（旧実装は201）
    ['percentage', 0, null, 400],      // 0%OFF明示
    ['percentage', 1, null, 201],      // 下限
    ['percentage', 100, null, 201],    // 上限
    ['percentage', 101, null, 400],    // 上限超過
    ['special_price', null, null, 400],       // ¥0特別価格扱い（旧実装は201）
    ['special_price', null, 0, 400],          // ¥0特別価格明示
    ['special_price', null, 1, 201],          // 下限
    ['special_price', null, 9999999, 201],    // 上限
    ['special_price', null, 10000000, 400],   // 上限超過
  ] as const)('discount_type=%s, discount_value=%p, special_price=%p → %d', async (dt, dv, sp, expected) => {
    setupCreatable();
    const res = await POST(makePostRequest(validPostBody({ discount_type: dt, discount_value: dv, special_price: sp })));
    expect(res.status).toBe(expected);
  });

  test('fixed で special_price に値を送っても insert では null に正規化される', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const insertMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: 'aaa' }, error: null })) }),
    });
    mockAdminFrom.mockReturnValue({ insert: insertMock });
    const res = await POST(makePostRequest(validPostBody({ discount_type: 'fixed', discount_value: 500, special_price: 3000 })));
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ discount_value: 500, special_price: null }));
  });

  test('special_price で discount_value に値を送っても insert では null に正規化される', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const insertMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: 'aaa' }, error: null })) }),
    });
    mockAdminFrom.mockReturnValue({ insert: insertMock });
    const res = await POST(makePostRequest(validPostBody({ discount_type: 'special_price', discount_value: 500, special_price: 3000 })));
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ discount_value: null, special_price: 3000 }));
  });
});

// ─── 【2026年7月15日 HPB準拠仕様】target_menu_ids（coupon_menus 同期） ─────────────
describe('POST: target_menu_ids（対象メニュー限定の保存）', () => {
  const MENU_UUID_1 = '44444444-4444-4444-8444-444444444444';
  const MENU_UUID_2 = '55555555-5555-4555-8555-555555555555';

  // facility_menus 検証チェーン: select('id').in(...).eq(facility_id) を直接 await。
  function facilityMenusChain(rows: { id: string }[] | null, error: unknown = null) {
    const result = { data: rows, error };
    const chain: Record<string, unknown> = {};
    const handler = jest.fn(() => chain);
    chain.select = handler;
    chain.in = handler;
    chain.eq = handler;
    chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
    return chain;
  }

  test('target_menu_ids あり・全て自施設メニュー → coupon_menus に insert され 201', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }, { id: MENU_UUID_2 }]);
      if (table === 'coupon_menus') return { insert: cmInsert };
      return insertSingle({ id: 'new-coupon-id' });
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1, MENU_UUID_2] })));
    expect(res.status).toBe(201);
    expect(cmInsert).toHaveBeenCalledWith([
      { coupon_id: 'new-coupon-id', menu_id: MENU_UUID_1 },
      { coupon_id: 'new-coupon-id', menu_id: MENU_UUID_2 },
    ]);
  });

  test('target_menu_ids に他施設（実在しない）メニューIDが混入 → 400', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]); // MENU_UUID_2 は自施設に無い
      return insertSingle({ id: 'new-coupon-id' });
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1, MENU_UUID_2] })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('対象メニュー');
  });

  test('facility_menus 検証クエリがエラー → 500', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain(null, { message: 'db error' });
      return insertSingle({ id: 'new-coupon-id' });
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    expect(res.status).toBe(500);
  });

  test('facility_menus 検証が data:null（error なし）→ 実在確認できず 400（?? [] フォールバック）', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain(null, null);
      return insertSingle({ id: 'new-coupon-id' });
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    expect(res.status).toBe(400);
  });

  test('target_menu_ids が空配列 → coupon_menus に触れず 201（全メニュー適用クーポン）', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'coupon_menus') return { insert: cmInsert };
      return insertSingle({ id: 'new-coupon-id' });
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [] })));
    expect(res.status).toBe(201);
    expect(cmInsert).not.toHaveBeenCalled();
  });

  test('target_menu_ids に UUID でない値 → 400（zod）', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: ['not-a-uuid'] })));
    expect(res.status).toBe(400);
  });

  test('coupon_menus insert 失敗 → クーポンをロールバック削除して 500（限定なしクーポンの残存＝金銭事故を防ぐ）', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const rollbackDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) };
      return { ...insertSingle({ id: 'new-coupon-id' }), delete: rollbackDelete };
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    expect(res.status).toBe(500);
    expect(rollbackDelete).toHaveBeenCalled();
  });

  test('三重失敗（insert失敗+削除失敗+無効化も失敗）→ Sentry+Slack通知＋明示メッセージの500（無音再現の根治）', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const rollbackDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })) });
    const deactivateUpdate = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'deactivate failed' } })) });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) };
      return { ...insertSingle({ id: 'new-coupon-id' }), delete: rollbackDelete, update: deactivateUpdate };
    });
    const { safeCaptureException } = require('@/lib/safe');
    const { alertCaughtError } = require('@/lib/alert');
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    expect(res.status).toBe(500);
    const json = await res.json();
    // 汎用メッセージではなく「無効化できなかった・至急確認」を明示する（管理者が気づける）
    expect(json.error).toContain('無効化できませんでした');
    expect(json.error).toContain('至急');
    // 無音にしない＝Sentry+Slack の両方へ通知
    expect(safeCaptureException).toHaveBeenCalledWith(expect.any(Error), 'admin-coupons-create-rollback');
    expect(alertCaughtError).toHaveBeenCalledWith('admin-coupons-create-rollback', expect.any(Error), '/api/admin/coupons');
  });

  test('coupon_menus insert 失敗＋ロールバック削除も失敗 → is_active=false へ無効化して 500', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const rollbackDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })) });
    const deactivateUpdate = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) };
      return { ...insertSingle({ id: 'new-coupon-id' }), delete: rollbackDelete, update: deactivateUpdate };
    });
    const res = await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    expect(res.status).toBe(500);
    expect(deactivateUpdate).toHaveBeenCalledWith({ is_active: false });
  });

  test('監査ログに target_menu_ids が記録される', async () => {
    mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { insert: cmInsert };
      return insertSingle({ id: 'new-coupon-id' });
    });
    const { writeAuditLog } = require('@/lib/audit-logger');
    await POST(makePostRequest(validPostBody({ target_menu_ids: [MENU_UUID_1] })));
    await new Promise(r => setTimeout(r, 10));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      newValues: expect.objectContaining({ target_menu_ids: [MENU_UUID_1] }),
    }));
  });
});
