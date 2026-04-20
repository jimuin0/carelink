/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/platform-blog
 * Key assertions:
 *   - Platform-admin only → 403 for non-admin
 *   - slug regex /^[a-z0-9-]+$/
 *   - reading_time 1-999
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/platform-blog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { slug: 'test-post', title: 'テスト投稿', ...overrides };
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
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

test('POST: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: slug が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makeRequest(validBody({ slug: '' })));
  expect(res.status).toBe(400);
});

test('POST: slug に大文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makeRequest(validBody({ slug: 'Test-Post' })));
  expect(res.status).toBe(400);
});

test('POST: slug にアンダースコア → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makeRequest(validBody({ slug: 'test_post' })));
  expect(res.status).toBe(400);
});

test('POST: reading_time が 0 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makeRequest(validBody({ reading_time: 0 })));
  expect(res.status).toBe(400);
});

test('POST: reading_time が 1000 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makeRequest(validBody({ reading_time: 1000 })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with post', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'post-1', slug: 'test-post' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.post).toBeDefined();
});

test('POST: is_published=true → 201', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'post-1', is_published: true }));
  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
});
