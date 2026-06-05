/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/features
 * Key assertions:
 *   - SUPER_ADMIN_USER_IDS env var gating → 401 for non-super-admin
 *   - image_url must be URL or empty string
 *   - sort_order 0-9999
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID = '33333333-3333-3333-3333-333333333333';

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
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { title: 'テスト特集', ...overrides };
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.SUPER_ADMIN_USER_IDS = USER_ID;
});

afterEach(() => {
  delete process.env.SUPER_ADMIN_USER_IDS;
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: SUPER_ADMIN_USER_IDS 未設定 → 401', async () => {
  delete process.env.SUPER_ADMIN_USER_IDS;
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: 異なるユーザーID → 401', async () => {
  process.env.SUPER_ADMIN_USER_IDS = 'other-user-id';
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: title が空 → 400', async () => {
  const res = await POST(makeRequest(validBody({ title: '' })));
  expect(res.status).toBe(400);
});

test('POST: image_url が不正URL → 400', async () => {
  const res = await POST(makeRequest(validBody({ image_url: 'not-a-url' })));
  expect(res.status).toBe(400);
});

test('POST: sort_order が 10000 → 400', async () => {
  const res = await POST(makeRequest(validBody({ sort_order: 10000 })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with feature', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'feature-1', title: 'テスト特集' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.feature).toBeDefined();
});

test('POST: image_url が空文字 → 201', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'feature-1' }));
  const res = await POST(makeRequest(validBody({ image_url: '' })));
  expect(res.status).toBe(201);
});

test('POST: 複数スーパー管理者のうち1人 → 201', async () => {
  process.env.SUPER_ADMIN_USER_IDS = `other-id, ${USER_ID}, another-id`;
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'feature-1' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(201);
});

test('POST: title が 201 文字 → 400', async () => {
  const res = await POST(makeRequest(validBody({ title: 'あ'.repeat(201) })));
  expect(res.status).toBe(400);
});

test('POST: title が 200 文字 → 201', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'f1' }));
  const res = await POST(makeRequest(validBody({ title: 'あ'.repeat(200) })));
  expect(res.status).toBe(201);
});

test('POST: sort_order が 0 → 201', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'f1' }));
  const res = await POST(makeRequest(validBody({ sort_order: 0 })));
  expect(res.status).toBe(201);
});

test('POST: sort_order が 9999 → 201', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'f1' }));
  const res = await POST(makeRequest(validBody({ sort_order: 9999 })));
  expect(res.status).toBe(201);
});

test('POST: image_url が有効 URL → 201', async () => {
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'f1' }));
  const res = await POST(makeRequest(validBody({ image_url: 'https://example.com/img.jpg' })));
  expect(res.status).toBe(201);
});

test('POST: CSRF エラー → CSRF レスポンス', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: レートリミット params (20req/60s)', () => {
  (checkRateLimit as jest.Mock).mockClear();
  POST(makeRequest(validBody()));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('POST: subtitle が 301 文字 → 400', async () => {
  const res = await POST(makeRequest(validBody({ subtitle: 'あ'.repeat(301) })));
  expect(res.status).toBe(400);
});
