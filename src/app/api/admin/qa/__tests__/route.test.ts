/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/qa
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - action=toggle-public, action=delete, default=answer
 *   - qa_id uses z.string().uuid() → requires RFC 4122 UUID
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';
const QA_UUID       = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // RFC 4122

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
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object, action: string | null = null, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/qa');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  if (action) url.searchParams.set('action', action);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateEqEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

function deleteEqEq(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
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

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'テスト回答' }));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'テスト回答' }));
  expect(res.status).toBe(429);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'テスト回答' }));
  expect(res.status).toBe(401);
});

test('POST: answer が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: '' }));
  expect(res.status).toBe(400);
});

test('POST: answer が不正なqa_id → 400 (非RFC4122UUID)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: 'not-a-uuid', answer: 'テスト回答' }));
  expect(res.status).toBe(400);
});

test('POST: answer DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq({ message: 'DB error' }));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'テスト回答' }));
  expect(res.status).toBe(500);
});

test('POST: answer 正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq(null));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'テスト回答' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('POST: toggle-public, qa_id 不正 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: 'bad', is_public: true }, 'toggle-public'));
  expect(res.status).toBe(400);
});

test('POST: toggle-public, is_public 欠落 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: QA_UUID }, 'toggle-public'));
  expect(res.status).toBe(400);
});

test('POST: toggle-public, DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq({ message: 'DB error' }));
  const res = await POST(makeRequest({ qa_id: QA_UUID, is_public: true }, 'toggle-public'));
  expect(res.status).toBe(500);
});

test('POST: toggle-public, 正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq(null));
  const res = await POST(makeRequest({ qa_id: QA_UUID, is_public: false }, 'toggle-public'));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('POST: delete, DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteEqEq({ message: 'DB error' }));
  const res = await POST(makeRequest({ qa_id: QA_UUID }, 'delete'));
  expect(res.status).toBe(500);
});

test('POST: delete, 正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteEqEq(null));
  const res = await POST(makeRequest({ qa_id: QA_UUID }, 'delete'));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: '回答' }));
  expect(res.status).toBe(403);
});

test('POST: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq(null));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makeRequest({ qa_id: QA_UUID, answer: '回答' }));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('POST: answer が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'a'.repeat(2001) }));
  expect(res.status).toBe(400);
});

test('POST: answer が 2000文字 → 200 (上限ぴったり)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEqEq(null));
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: 'a'.repeat(2000) }));
  expect(res.status).toBe(200);
});

test('POST: facility_id なし → 401', async () => {
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: '回答' }, null, null));
  expect(res.status).toBe(401);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const res = await POST(makeRequest({ qa_id: QA_UUID, answer: '回答' }, null, 'not-uuid'));
  expect(res.status).toBe(401);
});

test('POST: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/qa');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

// Branch coverage: line 75 — action=delete で deleteSchema バリデーション失敗 → 400（true 分岐）
test('POST: delete, qa_id が不正UUID → deleteSchema 失敗 → 400（line 75 true 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest({ qa_id: 'not-a-uuid' }, 'delete'));
  expect(res.status).toBe(400);
});
