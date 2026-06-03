/**
 * @jest-environment node
 *
 * Tests for POST/DELETE /api/admin/community/posts/[id]/likes
 * Key assertions:
 *   - Non-member → 403
 *   - Post not found → 404
 *   - Locked post → 403
 *   - Duplicate like → 409 (unique constraint code 23505)
 *   - DELETE: 200 with updated like_count
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
import { POST, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string) {
  return new NextRequest(`http://localhost/api/admin/community/posts/${POST_UUID}/likes`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

function postSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertChain(error: unknown = null) {
  return {
    insert: jest.fn(() => Promise.resolve({ error })),
  };
}

function deleteChain(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

// Setup: member OK → post OK → insert OK → like_count OK
function setupLikeSuccess() {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    if (callNum === 3) return insertChain(null);
    return postSingle({ like_count: 5 });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── POST (like) ──────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(429);
});

test('POST: 不正なUUID → 400', async () => {
  const res = await POST(makeRequest('POST'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(403);
});

test('POST: 投稿が見つからない → 404', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postSingle(null); // post not found
  });
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(404);
});

test('POST: 投稿がロック済み → 403', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return postSingle({ id: POST_UUID, is_locked: true });
  });
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(403);
});

test('POST: 重複いいね → 409 (unique constraint)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertChain({ code: '23505', message: 'duplicate key' });
  });
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(409);
});

test('POST: 正常いいね → 201 with like_count', async () => {
  setupLikeSuccess();
  const res = await POST(makeRequest('POST'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(typeof json.like_count).toBe('number');
});

// ─── DELETE (unlike) ──────────────────────────────────────────────────────────

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 非メンバー → 403', async () => {
  mockAdminFrom.mockReturnValue(memberSingle(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: 正常削除 → 200 with like_count', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return deleteChain(null);
    return postSingle({ like_count: 4 });
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(typeof json.like_count).toBe('number');
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(403);
});

test('POST: DB insert error (non-23505) → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    return insertChain({ code: '23000', message: 'DB error' });
  });
  const res = await POST(makeRequest('POST'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: DB delete error → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    return deleteChain({ message: 'DB error' });
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('POST: likeCount が null → like_count=0', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    if (callNum === 3) return insertChain(null);
    return postSingle(null);
  });
  const res = await POST(makeRequest('POST'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.like_count).toBe(0);
});

test('POST: likeCount.like_count が undefined → 0', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return postSingle({ id: POST_UUID, is_locked: false });
    if (callNum === 3) return insertChain(null);
    return postSingle({}); // like_count undefined
  });
  const res = await POST(makeRequest('POST'), makeProps());
  const json = await res.json();
  expect(json.like_count).toBe(0);
});

test('DELETE: post が null → like_count=0', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return deleteChain(null);
    return postSingle(null);
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.like_count).toBe(0);
});

test('POST: x-forwarded-for ヘッダ → IP抽出', async () => {
  setupLikeSuccess();
  (checkRateLimit as jest.Mock).mockClear();
  const req = new NextRequest(`http://localhost/api/admin/community/posts/${POST_UUID}/likes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await POST(req, makeProps());
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

test('DELETE: x-forwarded-for ヘッダ → IP抽出', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return memberSingle({ facility_id: '11' });
    if (callNum === 2) return deleteChain(null);
    return postSingle({ like_count: 3 });
  });
  (checkRateLimit as jest.Mock).mockClear();
  const req = new NextRequest(`http://localhost/api/admin/community/posts/${POST_UUID}/likes`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await DELETE(req, makeProps());
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});
