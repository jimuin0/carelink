/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/report
 * Key assertions:
 *   - facility_id, from, to required
 *   - from/to must be YYYY-MM-DD
 *   - to must be >= from
 *   - max 366 day range
 *   - Non-member → 403
 *   - No data → 404
 *   - Returns CSV with BOM
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { GET } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/report');
  const defaults = { facility_id: FACILITY_UUID, from: '2026-01-01', to: '2026-01-31' };
  for (const [k, v] of Object.entries({ ...defaults, ...params })) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function memberMaybeSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function revenueChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error })),
  };
}

const SAMPLE_ROWS = [
  { date: '2026-01-01', total_revenue: 50000, booking_count: 5, completed_count: 4, cancelled_count: 1, no_show_count: 0, new_customer_count: 2, repeat_customer_count: 3 },
];

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

test('GET: facility_id なし → 400', async () => {
  const url = new URL('http://localhost/api/admin/report');
  url.searchParams.set('from', '2026-01-01');
  url.searchParams.set('to', '2026-01-31');
  const res = await GET(new NextRequest(url.toString(), { method: 'GET' }));
  expect(res.status).toBe(400);
});

test('GET: from なし → 400', async () => {
  const url = new URL('http://localhost/api/admin/report');
  url.searchParams.set('facility_id', FACILITY_UUID);
  url.searchParams.set('to', '2026-01-31');
  const res = await GET(new NextRequest(url.toString(), { method: 'GET' }));
  expect(res.status).toBe(400);
});

test('GET: 不正な facility_id → 400', async () => {
  const res = await GET(makeRequest({ facility_id: 'bad-uuid' }));
  expect(res.status).toBe(400);
});

test('GET: from が不正形式 → 400', async () => {
  const res = await GET(makeRequest({ from: '2026/01/01' }));
  expect(res.status).toBe(400);
});

test('GET: to が from より前 → 400', async () => {
  const res = await GET(makeRequest({ from: '2026-01-31', to: '2026-01-01' }));
  expect(res.status).toBe(400);
});

test('GET: 366日超え → 400', async () => {
  const res = await GET(makeRequest({ from: '2025-01-01', to: '2026-02-01' }));
  expect(res.status).toBe(400);
});

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(memberMaybeSingle(null));
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('GET: データなし → 404', async () => {
  mockAnonFrom.mockReturnValue(memberMaybeSingle({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(revenueChain([]));
  const res = await GET(makeRequest());
  expect(res.status).toBe(404);
});

test('GET: 正常取得 → 200 CSV', async () => {
  mockAnonFrom.mockReturnValue(memberMaybeSingle({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(revenueChain(SAMPLE_ROWS));
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  const text = await res.text();
  expect(text).toContain('日付');
  expect(text).toContain('2026-01-01');
});
