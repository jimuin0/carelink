/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/community/posts/[id]/replies
 * Key assertions:
 *   - Non-member → 403
 *   - Post not found → 404
 *   - Locked post → 403
 *   - body required → 400
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const POST_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID   = '33333333-3333-3333-3333-333333333333';

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
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string, body?: object) {
  return new NextRequest(`http://localhost/api/admin/community/posts/${POST_UUID}/replies`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function replyListChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function postSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertReplySingle(data: unknown, error: unknown = null) {
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
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(429);
});

test('GET: 不正なUUID → 400', async () => {
  const res = await GET(makeRequest('GET'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('GET: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with replies', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return replyListChain([{ id: 'reply-1', body: 'Hello' }]);
  });
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.replies).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest('POST', { body: 'Reply text' }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: 不正なUUID → 400', async () => {
  const res = await POST(makeRequest('POST', { body: 'Reply' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest('POST', { body: 'Reply' }), makeProps());
  expect(res.status).toBe(403);
});

test('POST: body が空 → 400', async () => {
  mockAdminFrom.mockReturnValue(memberSingle({ facility_id: '11' }));
  const res = await POST(makeRequest('POST', { body: '' }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: 投稿が見つからない → 404', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postSingle(null);
  });
  const res = await POST(makeRequest('POST', { body: 'Reply' }), makeProps());
  expect(res.status).toBe(404);
});

test('POST: 投稿がロック済み → 403', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postSingle({ id: POST_UUID, is_locked: true });
  });
  const res = await POST(makeRequest('POST', { body: 'Reply' }), makeProps());
  expect(res.status).toBe(403);
});

test('POST: 正常投稿 → 201 with reply', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertReplySingle({ id: 'reply-1', body: 'Reply' });
  });
  const res = await POST(makeRequest('POST', { body: 'Reply text' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.reply).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest('POST', { body: 'Reply' }), makeProps());
  expect(res.status).toBe(403);
});

test('POST: body が 2001文字 → 2000文字に切り詰めて 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertReplySingle({ id: 'r', body: 'a'.repeat(2000) });
  });
  const res = await POST(makeRequest('POST', { body: 'a'.repeat(2001) }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertReplySingle(null, { message: 'DB error' });
  });
  const res = await POST(makeRequest('POST', { body: 'Reply text' }), makeProps());
  expect(res.status).toBe(500);
});

test('GET: 正常取得 → レスポンスが { replies: [...] } 形式', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return replyListChain([{ id: 'reply-1', body: 'Hello' }]);
  });
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  expect(json.replies).toBeDefined();
  expect(Array.isArray(json.replies)).toBe(true);
});

test('GET: DB エラー → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return replyListChain([], { message: 'DB error' });
  });
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(500);
});

test('POST: レスポンスが { reply: ... } 形式', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertReplySingle({ id: 'reply-1', body: 'Reply text' });
  });
  const res = await POST(makeRequest('POST', { body: 'Reply text' }), makeProps());
  const json = await res.json();
  expect(json.reply).toBeDefined();
  expect(json.reply.id).toBe('reply-1');
});
