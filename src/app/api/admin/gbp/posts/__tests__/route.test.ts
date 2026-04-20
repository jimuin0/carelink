/**
 * @jest-environment node
 *
 * Tests for GET/POST/PATCH/DELETE /api/admin/gbp/posts
 * Key assertions:
 *   - Non-member → 403 (all methods)
 *   - POST: body content required
 *   - PATCH: id required and must be UUID
 *   - DELETE: id in query param required and must be UUID
 *   - DB failure → 500
 * Note: All operations use the SSR (anon) Supabase client, not service role.
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const POST_UUID     = '11111111-1111-1111-1111-111111111111';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { GET, POST, PATCH, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

// Membership check: limit(1).single() → Promise
function membershipSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// GBP posts list: limit(N) → Promise
function postListChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// Insert: insert().select().single()
function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

// Update: update().eq().eq() → Promise
function updateEqEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

// Delete: delete().eq().eq() → Promise
function deleteEqEq(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

const MEMBER_DATA = { facility_id: FACILITY_UUID };

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
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(429);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return postListChain([], { message: 'DB error' });
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(500);
});

test('GET: 正常取得 → 200 with posts', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return postListChain([{ id: POST_UUID }]);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: body が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '' }),
  }));
  expect(res.status).toBe(400);
});

test('POST: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 200 with post', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return insertSingle({ id: POST_UUID, body: 'テスト投稿' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.post).toBeDefined();
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '更新' }),
  }));
  expect(res.status).toBe(400);
});

test('PATCH: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad-uuid', title: '更新' }),
  }));
  expect(res.status).toBe(400);
});

test('PATCH: 正常更新 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEqEq(null);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新タイトル' }),
  }));
  expect(res.status).toBe(200);
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts?id=bad-uuid', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: 正常削除 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return deleteEqEq(null);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(200);
});
