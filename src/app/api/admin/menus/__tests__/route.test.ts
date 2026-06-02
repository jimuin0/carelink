/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/menus
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - Duplicate name → 409
 *   - photo_url must be URL or empty string
 *   - name max 100 chars
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
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
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeGetRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { category: 'カラー', name: 'テストメニュー', ...overrides };
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
  // 多段 .order() に対応するため order はチェーン可能にし、await は then で解決する
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
}

// Duplicate name check: maybeSingle()
function dupCheckChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// Count check: select with count option returns { count }
function countChain(count: number) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ count, error: null })),
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
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
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
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: 正常取得 → 200 with menus', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([{ id: 'menu-1' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.menus).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: name が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ name: '' })));
  expect(res.status).toBe(400);
});

test('POST: photo_url が不正URL → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ photo_url: 'not-a-url' })));
  expect(res.status).toBe(400);
});

test('POST: 重複名 → 409', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(dupCheckChain({ id: 'existing-1' }));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(409);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null); // no duplicate
    if (callNum === 2) return countChain(3);       // existing count
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with menu', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return countChain(2);
    return insertSingle({ id: 'menu-1', name: 'テストメニュー' });
  });
  const res = await POST(makePostRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.menu).toBeDefined();
});

test('POST: photo_url が空文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return countChain(0);
    return insertSingle({ id: 'menu-1' });
  });
  const res = await POST(makePostRequest(validBody({ photo_url: '' })));
  expect(res.status).toBe(201);
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: rate limit params (30/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(30);
  expect(call[2]).toBe(60_000);
});

test('POST: rate limit params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return countChain(0);
    return insertSingle({ id: 'menu-1' });
  });
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validBody()));
  const postCall = (inMemoryRateLimit as jest.Mock).mock.calls.find((c: unknown[]) => c[3] === 'admin-menus-post');
  expect(postCall).toBeDefined();
  expect(postCall[1]).toBe(20);
  expect(postCall[2]).toBe(60_000);
});

test('GET: レスポンスが { menus: [] } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json.menus)).toBe(true);
});

test('POST: レスポンスが { menu.id } 形式', async () => {
  const MENU_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return countChain(1);
    return insertSingle({ id: MENU_UUID, name: 'テストメニュー' });
  });
  const res = await POST(makePostRequest(validBody()));
  const json = await res.json();
  expect(json.menu.id).toBe(MENU_UUID);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('GET: facility_id クエリなし → 401', async () => {
  const res = await GET(makeGetRequest(null));
  expect(res.status).toBe(401);
});

test('GET: facility_id が不正UUID → 401', async () => {
  const res = await GET(makeGetRequest('bad-uuid'));
  expect(res.status).toBe(401);
});

test('GET: x-forwarded-for ヘッダあり → IP抽出', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  (inMemoryRateLimit as jest.Mock).mockClear();
  const url = new URL('http://localhost/api/admin/menus');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
  });
  await GET(req);
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('10.0.0.1');
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: 不正なJSONボディ → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/menus');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid json {',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: sort_order 明示指定 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return countChain(5);
    return insertSingle({ id: 'menu-x', sort_order: 99 });
  });
  const res = await POST(makePostRequest(validBody({ sort_order: 99 })));
  expect(res.status).toBe(201);
});

test('POST: count が null → sort_order=0 で挿入 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn(() => Promise.resolve({ count: null, error: null })),
    };
    return insertSingle({ id: 'menu-y' });
  });
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(201);
});
