/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/coupons/[id]
 * Key assertions:
 *   - facility_id defence-in-depth in UPDATE/DELETE WHERE clause
 *   - percentage discount_value > 100 rejected by Zod refine
 *   - IDOR: other facility's coupon → 401
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const COUPON_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/admin/coupons/1`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = COUPON_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// Sets up coupon lookup (admin) + membership check (anon)
function setupOwnership() {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return buildUpdateOrDeleteChain();
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
}

function buildUpdateOrDeleteChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error })),
          }),
        }),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data: error ? null : [{ id: COUPON_UUID }], error })),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── PATCH: guards ────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 他施設のクーポン → 401 (IDOR防止)', async () => {
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: 'other-facility' }));
  mockAnonFrom.mockReturnValue(singleChain(null)); // not a member
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

// ─── PATCH: Zod refine validation ────────────────────────────────────────────

test('PATCH: percentage discount_value > 100 → 400', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest('PATCH', { discount_type: 'percentage', discount_value: 101 }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: percentage discount_value = 100 → 200 (境界値)', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest('PATCH', { discount_type: 'percentage', discount_value: 100 }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: fixed discount_value > 100 は許可', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest('PATCH', { discount_type: 'fixed', discount_value: 5000 }), makeProps());
  expect(res.status).toBe(200);
});

// ─── PATCH: defence-in-depth ──────────────────────────────────────────────────

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  let adminCallNum = 0;
  const secondEq = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      maybeSingle: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error: null })),
    }),
  });
  const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
  const updateMock = jest.fn().mockReturnValue({ eq: firstEq });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  await PATCH(makeRequest('PATCH', { name: 'updated' }), makeProps());

  expect(firstEq).toHaveBeenCalledWith('id', COUPON_UUID);
  expect(secondEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
            }),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(500);
});

// ─── DELETE: guards ───────────────────────────────────────────────────────────

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 他施設のクーポン → 401', async () => {
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: 'other-facility' }));
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

function redemptionCountChain(count: number, error: unknown = null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ count, error })) }) };
}

test('DELETE: 利用実績なし → DELETEのWHEREにfacility_idが含まれ成功 → 200', async () => {
  let adminCallNum = 0;
  const innerEq = jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: COUPON_UUID }], error: null })) });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const deleteMock = jest.fn().mockReturnValue({ eq: outerEq });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return { delete: deleteMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('deleted');
  expect(outerEq).toHaveBeenCalledWith('id', COUPON_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('DELETE: 利用実績あり → 削除せず無効化のみ → 200', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: [{ id: COUPON_UUID }], error: null }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('利用実績があるため無効化しました');
  expect(updateMock).toHaveBeenCalledWith({ is_active: false });
});

test('DELETE: 利用実績あり → 無効化のDB更新自体が失敗 → 500', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 利用実績あり・無効化0行（verify後にTOCTOU削除）→ 404', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: 利用実績カウント取得失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return redemptionCountChain(0, { message: 'DB error' });
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: DB削除失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 利用実績なし・削除0行 (verify後にTOCTOU削除) → 404', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn(() => Promise.resolve({ data: [], error: null })),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res).toBe(csrfRes);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: data null → 404', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
            }),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/coupons/${COUPON_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '9.9.9.9, 1.1.1.1' },
    body: JSON.stringify({ name: 'x' }),
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: 不正な JSON body → 400', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/coupons/${COUPON_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(400);
});

// Branch coverage: line 31 — coupon が存在しないとき !coupon → null 返却（true 分岐 → 401）
test('PATCH: クーポンが存在しない → verifyCouponAdmin null → 401（line 31 true 分岐）', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(401);
});

// ─── 【2026年7月15日 HPB準拠仕様】zod強化＝discount_type×値の相互必須（PATCH） ─────
describe('PATCH: discount_type×値の相互必須', () => {
  test.each([
    ['fixed', null, null, 400],      // 0円引き化（旧実装は200で更新できた）
    ['fixed', 0, null, 400],
    ['fixed', 1, null, 200],
    ['percentage', null, null, 400], // 0%OFF化
    ['percentage', 0, null, 400],
    ['percentage', 1, null, 200],
    ['special_price', null, null, 400],  // ¥0特別価格化
    ['special_price', null, 0, 400],
    ['special_price', null, 1, 200],
  ] as const)('discount_type=%s, discount_value=%p, special_price=%p → %d', async (dt, dv, sp, expected) => {
    setupOwnership();
    const res = await PATCH(makeRequest('PATCH', { discount_type: dt, discount_value: dv, special_price: sp }), makeProps());
    expect(res.status).toBe(expected);
  });

  test('discount_type を送らず discount_value だけ更新 → 400（型不明のまま値だけ更新は不整合の素通り防止）', async () => {
    setupOwnership();
    const res = await PATCH(makeRequest('PATCH', { discount_value: 150 }), makeProps());
    expect(res.status).toBe(400);
  });

  test('discount_type を送らず special_price だけ更新 → 400', async () => {
    setupOwnership();
    const res = await PATCH(makeRequest('PATCH', { special_price: 500 }), makeProps());
    expect(res.status).toBe(400);
  });

  test('discount_type 未指定で name のみ更新 → 200（部分更新は従来どおり許可）', async () => {
    setupOwnership();
    const res = await PATCH(makeRequest('PATCH', { name: '新しい名前' }), makeProps());
    expect(res.status).toBe(200);
  });

  test('special_price 型へ変更時、UPDATE payload の discount_value が null に正規化される', async () => {
    let adminCallNum = 0;
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error: null })),
          }),
        }),
      }),
    });
    mockAdminFrom.mockImplementation(() => {
      adminCallNum++;
      if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return { update: updateMock };
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { discount_type: 'special_price', special_price: 3000, discount_value: 500 }), makeProps());
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ discount_type: 'special_price', special_price: 3000, discount_value: null }));
  });
});

// ─── 【2026年7月15日 HPB準拠仕様】target_menu_ids（coupon_menus の delete→insert 同期） ─────
describe('PATCH: target_menu_ids（対象メニュー限定の同期）', () => {
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

  function updateChain(data: unknown = { id: COUPON_UUID }, error: unknown = null) {
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
            }),
          }),
        }),
      }),
    };
  }

  test('target_menu_ids 非空 → coupon_menus を delete→insert で置換して 200', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }, { id: MENU_UUID_2 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // verifyCouponAdmin
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1, MENU_UUID_2] }), makeProps());
    expect(res.status).toBe(200);
    expect(cmDelete).toHaveBeenCalled();
    expect(cmInsert).toHaveBeenCalledWith([
      { coupon_id: COUPON_UUID, menu_id: MENU_UUID_1 },
      { coupon_id: COUPON_UUID, menu_id: MENU_UUID_2 },
    ]);
  });

  test('target_menu_ids 空配列 → delete のみで insert されず 200（限定解除＝全メニュー適用へ）', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [] }), makeProps());
    expect(res.status).toBe(200);
    expect(cmDelete).toHaveBeenCalled();
    expect(cmInsert).not.toHaveBeenCalled();
  });

  test('target_menu_ids 未指定 → coupon_menus に一切触れない（従来どおりの部分更新）', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'coupon_menus') return { delete: cmDelete };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
    expect(res.status).toBe(200);
    expect(cmDelete).not.toHaveBeenCalled();
  });

  test('target_menu_ids のみ送信（coupons 列の変更なし）→ update({}) を発行せず存在確認 SELECT で 200', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    const updateMock = jest.fn();
    const selectMaybeSingle = jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error: null }));
    const selectChain: Record<string, unknown> = {};
    const selectHandler = jest.fn(() => selectChain);
    selectChain.select = selectHandler;
    selectChain.eq = selectHandler;
    selectChain.maybeSingle = selectMaybeSingle;
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return { ...singleChain({ facility_id: FACILITY_UUID }), update: updateMock };
      return { ...selectChain, update: updateMock };
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cmInsert).toHaveBeenCalled();
  });

  test('target_menu_ids のみ送信で存在確認 SELECT が 0 行 → 404', async () => {
    const selectMaybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const selectChain: Record<string, unknown> = {};
    const selectHandler = jest.fn(() => selectChain);
    selectChain.select = selectHandler;
    selectChain.eq = selectHandler;
    selectChain.maybeSingle = selectMaybeSingle;
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return selectChain;
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(404);
  });

  test('target_menu_ids のみ送信で存在確認 SELECT がエラー → 500', async () => {
    const selectMaybeSingle = jest.fn(() => Promise.resolve({ data: null, error: { message: 'db error' } }));
    const selectChain: Record<string, unknown> = {};
    const selectHandler = jest.fn(() => selectChain);
    selectChain.select = selectHandler;
    selectChain.eq = selectHandler;
    selectChain.maybeSingle = selectMaybeSingle;
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return selectChain;
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(500);
  });

  test('target_menu_ids に自施設に無いメニューIDが混入 → 400', async () => {
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]); // MENU_UUID_2 は無い
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1, MENU_UUID_2] }), makeProps());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('対象メニュー');
  });

  test('facility_menus 検証が data:null（error なし）→ 実在確認できず 400（?? [] フォールバック）', async () => {
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain(null, null);
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(400);
  });

  test('facility_menus 検証クエリがエラー → 500', async () => {
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain(null, { message: 'db error' });
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(500);
  });

  test('coupon_menus の delete が失敗 → 500（insert 前に中断）', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(500);
    expect(cmInsert).not.toHaveBeenCalled();
  });

  test('delete 成功後の insert が失敗 → クーポンを is_active=false に無効化して 500（限定が消えた全メニュー適用状態の残存＝金銭事故を防ぐ）', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } }));
    const deactivateEq = jest.fn(() => Promise.resolve({ error: null }));
    const deactivateUpdate = jest.fn().mockReturnValue({ eq: deactivateEq });
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      if (couponsCallNum === 2) return updateChain();
      return { update: deactivateUpdate };
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(500);
    expect(deactivateUpdate).toHaveBeenCalledWith({ is_active: false });
  });

  test('二重失敗（insert失敗+無効化も失敗）→ Sentry+Slack通知＋明示メッセージの500（無音再現の根治）', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } }));
    const deactivateEq = jest.fn(() => Promise.resolve({ error: { message: 'deactivate failed' } }));
    const deactivateUpdate = jest.fn().mockReturnValue({ eq: deactivateEq });
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      if (couponsCallNum === 2) return updateChain();
      return { update: deactivateUpdate };
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const { safeCaptureException } = require('@/lib/safe');
    const { alertCaughtError } = require('@/lib/alert');
    const res = await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    expect(res.status).toBe(500);
    const json = await res.json();
    // 汎用メッセージではなく「無効化できなかった・至急確認」を明示する（管理者が気づける）
    expect(json.error).toContain('無効化できませんでした');
    expect(json.error).toContain('至急');
    // 無音にしない＝Sentry+Slack の両方へ通知
    expect(safeCaptureException).toHaveBeenCalledWith(expect.any(Error), 'admin-coupons-update-sync');
    expect(alertCaughtError).toHaveBeenCalledWith('admin-coupons-update-sync', expect.any(Error), '/api/admin/coupons/[id]');
  });

  test('監査ログに target_menu_ids が記録される', async () => {
    const cmDelete = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
    const cmInsert = jest.fn(() => Promise.resolve({ error: null }));
    let couponsCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return facilityMenusChain([{ id: MENU_UUID_1 }]);
      if (table === 'coupon_menus') return { delete: cmDelete, insert: cmInsert };
      couponsCallNum++;
      if (couponsCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
      return updateChain();
    });
    mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

    const { writeAuditLog } = require('@/lib/audit-logger');
    await PATCH(makeRequest('PATCH', { name: 'x', target_menu_ids: [MENU_UUID_1] }), makeProps());
    await new Promise(r => setTimeout(r, 10));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      newValues: expect.objectContaining({ name: 'x', target_menu_ids: [MENU_UUID_1] }),
    }));
  });
});
