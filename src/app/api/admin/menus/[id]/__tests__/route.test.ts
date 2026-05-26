/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/menus/[id]
 * Key assertions:
 *   - facility_id in WHERE (defence-in-depth for cross-facility IDOR)
 *   - Duplicate name check → 409
 *   - photo_url must be valid URL or empty
 *   - facility_id query param required
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const MENU_UUID = '11111111-1111-1111-1111-111111111111';
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

import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(method: string, body?: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/menus/${MENU_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = MENU_UUID) {
  return { params: Promise.resolve({ id }) };
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function maybeSingleChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateSingleChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
      }),
    }),
  };
}

function deleteSingleChain(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

function setupMemberAndAdmin(adminCallSetup: () => Record<string, unknown>) {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(adminCallSetup);
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── PATCH: guards ────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id クエリパラメータなし → 401', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }, null), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(429);
});

// ─── PATCH: schema validation ─────────────────────────────────────────────────

test('PATCH: photo_url が無効URL → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { photo_url: 'not-a-url' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: photo_url が空文字 → 許可', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return maybeSingleChain(null); // no duplicate
    return updateSingleChain({ id: MENU_UUID, name: 'テスト', photo_url: null });
  });
  const res = await PATCH(makeRequest('PATCH', { name: 'テスト', photo_url: '' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: price が 10000000 (max 9999999超) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { price: 10000000 }), makeProps());
  expect(res.status).toBe(400);
});

// ─── PATCH: duplicate name check ─────────────────────────────────────────────

test('PATCH: 同じ名前のメニューが既存 → 409', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(maybeSingleChain({ id: 'other-menu-id' })); // duplicate found
  const res = await PATCH(makeRequest('PATCH', { name: '重複メニュー' }), makeProps());
  expect(res.status).toBe(409);
});

// ─── PATCH: defence-in-depth ─────────────────────────────────────────────────

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  let callNum = 0;
  const innerEq = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn(() => Promise.resolve({ data: { id: MENU_UUID }, error: null })),
    }),
  });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });

  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return maybeSingleChain(null); // no duplicate
    return { update: updateMock };
  });

  await PATCH(makeRequest('PATCH', { name: 'updated' }), makeProps());
  expect(outerEq).toHaveBeenCalledWith('id', MENU_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return maybeSingleChain(null);
    return updateSingleChain(null, { message: 'DB error' });
  });
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(500);
});

// ─── DELETE: guards and defence-in-depth ─────────────────────────────────────

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: DELETEのWHEREにfacility_idが含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const deleteMock = jest.fn().mockReturnValue({ eq: outerEq });
  mockAdminFrom.mockReturnValue({ delete: deleteMock });

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(200);
  expect(outerEq).toHaveBeenCalledWith('id', MENU_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('DELETE: DB削除失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteSingleChain({ message: 'DB error' }));
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

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id が UUID 形式でない → 401', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }, 'not-uuid'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: data null → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return maybeSingleChain(null);
    return updateSingleChain(null, null);
  });
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return maybeSingleChain(null);
    return updateSingleChain({ id: MENU_UUID }, null);
  });
  const url = new URL(`http://localhost/api/admin/menus/${MENU_UUID}`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify({ name: 'x' }),
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const url = new URL(`http://localhost/api/admin/menus/${MENU_UUID}`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: name 未指定でも更新可 (重複チェックスキップ)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingleChain({ id: MENU_UUID }, null));
  const res = await PATCH(makeRequest('PATCH', { price: 1000 }), makeProps());
  expect(res.status).toBe(200);
});

// Branch coverage: line 37 — verifyMenuAdmin が data=null のとき null を返す（false 分岐 → 401）
test('PATCH: facility_members が null → verifyMenuAdmin null → 401（line 37 false 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(401);
});
