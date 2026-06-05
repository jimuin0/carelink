/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/community/posts
 * Key assertions:
 *   - Non-facility-member → 403
 *   - Invalid category → 400
 *   - title/body required → 400
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/community/posts', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/community/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// facility_members: select → eq → in → limit → single
function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// community_posts list: select → order → order → order → limit → Promise
function postListChain(data: unknown[]) {
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data })),
  };
}

function insertPostSingle(data: unknown, error: unknown = null) {
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

test('GET: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with posts', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postListChain([{ id: 'post-1', title: 'Hello' }]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(401);
});

test('POST: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(403);
});

test('POST: title が空 → 400', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makePostRequest({ title: '', body: 'Body' }));
  expect(res.status).toBe(400);
});

test('POST: body が空 → 400', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makePostRequest({ title: 'Test', body: '' }));
  expect(res.status).toBe(400);
});

test('POST: 不正な category → 400', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body', category: 'spam' }));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with post', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle({ id: 'post-1', title: 'Test' });
  });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body', category: 'tips' }));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.post).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(403);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(429);
});

test('POST: レートリミット params (10/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle({ id: 'post-x', title: 'Test' });
  });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);
  expect(call[3]).toBe(60_000);
});

test('GET: レートリミット params (30/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postListChain([]);
  });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(30);
  expect(call[3]).toBe(60_000);
});

test('GET: データなし → 200 with empty posts', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postListChain([]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toEqual([]);
});

test('POST: category が "general" → 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle({ id: 'post-2', title: 'Test', category: 'general' });
  });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body', category: 'general' }));
  expect(res.status).toBe(201);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('GET: posts が null → 200 with []', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: null })),
    };
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toEqual([]);
});

test('POST: title が数値 → 400 (typeof check)', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makePostRequest({ title: 123, body: 'Body' }));
  expect(res.status).toBe(400);
});

test('POST: body が数値 → 400 (typeof check)', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makePostRequest({ title: 'Test', body: 456 }));
  expect(res.status).toBe(400);
});

test('POST: 不正JSONボディ → 400', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const req = new NextRequest('http://localhost/api/admin/community/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid {',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: category が数値 → 201 (typeof check により空文字扱い)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle({ id: 'post-y', title: 'Test' });
  });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body', category: 999 }));
  expect(res.status).toBe(201);
});

test('GET: x-forwarded-for ヘッダ → IP抽出', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postListChain([]);
  });
  (checkRateLimit as jest.Mock).mockClear();
  const req = new NextRequest('http://localhost/api/admin/community/posts', {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await GET(req);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

test('POST: category 省略 → 201 (デフォルト general)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return insertPostSingle({ id: 'post-3', title: 'Test', category: 'general' });
  });
  const res = await POST(makePostRequest({ title: 'Test', body: 'Body' }));
  expect(res.status).toBe(201);
});
