/**
 * @jest-environment node
 *
 * Tests for POST/PATCH /api/admin/chat/[roomId]
 * Key assertions:
 *   - Invalid roomId UUID → 400
 *   - Room not owned by admin's facility → 401 (IDOR prevention)
 *   - Content max 2000 chars
 *   - POST: inserts message, updates room last_message_at
 *   - PATCH: marks messages as read
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const ROOM_UUID     = '11111111-1111-1111-1111-111111111111';
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
import { POST, PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeProps(roomId = ROOM_UUID) {
  return { params: Promise.resolve({ roomId }) };
}

function makeRequest(method: string, body?: object) {
  return new NextRequest(`http://localhost/api/admin/chat/${ROOM_UUID}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
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

// chat_rooms: select → eq → eq → single
function roomSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertMessageChain(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

function updateRoomChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

function updateReadChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        neq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

function setupAuth() {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    return callNum; // caller replaces this
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(429);
});

test('POST: 不正なroomId UUID → 400', async () => {
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null)); // not a member
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: ルームが別施設のもの → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(roomSingle(null)); // room not found for this facility
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: content が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(roomSingle({ id: ROOM_UUID }));
  const res = await POST(makeRequest('POST', { content: '' }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: content が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(roomSingle({ id: ROOM_UUID }));
  const res = await POST(makeRequest('POST', { content: 'a'.repeat(2001) }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: メッセージ挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    return insertMessageChain(null, { message: 'DB error' });
  });
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(500);
});

test('POST: 正常送信 → 201 with message', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    if (callNum === 2) return insertMessageChain({ id: 'msg-1', content: 'Hello' });
    return updateRoomChain(null); // last_message_at update
  });
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.message).toBeDefined();
});

// ─── PATCH (mark read) ────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なroomId UUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: ルームが別施設のもの → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(roomSingle(null));
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 正常既読 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    return updateReadChain(null);
  });
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('POST: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await POST(makeRequest('POST', { content: 'x' }), makeProps());
  expect(res).toBe(csrfRes);
});

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  expect(res).toBe(csrfRes);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: mark-read DB失敗 → 500', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    return updateReadChain({ message: 'DB error' });
  });
  const res = await PATCH(makeRequest('PATCH'), makeProps());
  expect(res.status).toBe(500);
});

test('POST: last_message_at 更新失敗でもメッセージは201で返却', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    if (callNum === 2) return insertMessageChain({ id: 'msg-1', content: 'Hello' });
    return updateRoomChain({ message: 'fail' });
  });
  const res = await POST(makeRequest('POST', { content: 'Hello' }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(roomSingle({ id: ROOM_UUID }));
  const req = new NextRequest(`http://localhost/api/admin/chat/${ROOM_UUID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req, makeProps());
  expect(res.status).toBe(400);
});

test('POST: x-forwarded-for ヘッダから IP 取得', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return roomSingle({ id: ROOM_UUID });
    if (callNum === 2) return insertMessageChain({ id: 'msg-1', content: 'Hi' });
    return updateRoomChain(null);
  });
  const req = new NextRequest(`http://localhost/api/admin/chat/${ROOM_UUID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify({ content: 'Hi' }),
  });
  const res = await POST(req, makeProps());
  expect(res.status).toBe(201);
});
