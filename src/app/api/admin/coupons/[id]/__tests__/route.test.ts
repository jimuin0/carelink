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
            single: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error })),
          }),
        }),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
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
      single: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error: null })),
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
              single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
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
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
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
  const updateEq2 = jest.fn(() => Promise.resolve({ error: null }));
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
          eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
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
              single: jest.fn(() => Promise.resolve({ data: null, error: null })),
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
