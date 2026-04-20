/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/registrations
 * Key assertions:
 *   - Platform-admin only → 403
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { GET } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/registrations', { method: 'GET' });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest());
  expect(res.status).toBe(429);
});

test('GET: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('GET: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(listChain([], { message: 'DB error' }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
});

test('GET: 正常取得 → 200 with salons', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(listChain([{ id: 'salon-1', name: 'テストサロン' }]));
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.salons).toBeDefined();
});

test('GET: データなし → 200 with empty array', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(listChain([]));
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.salons).toEqual([]);
});
