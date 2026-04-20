/**
 * @jest-environment node
 *
 * Tests for GET /api/v1/bookings
 * Key assertions:
 *   - API key scope enforcement (bookings:read required)
 *   - Cross-facility access prevented (facility_id must match API key)
 *   - Expired API key → 401
 *   - Input validation: date format, status enum
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const mockFrom = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const VALID_KEY = 'valid-api-key-32chars-minimum!!';

function makeRequest(params: Record<string, string> = {}, apiKey = VALID_KEY) {
  const url = new URL('http://localhost/api/v1/bookings');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function apiKeyChain(keyData: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: keyData, error: null })),
  };
}

function bookingsChain(data: unknown[], count = 0) {
  const chain: Record<string, jest.Mock> = {};
  const link = jest.fn().mockReturnValue(chain);
  chain.select = link; chain.eq = link; chain.order = link;
  chain.gte = link; chain.lte = link; chain.range = link;
  chain.eq = link;
  chain.range = jest.fn(() => Promise.resolve({ data, error: null, count }));
  return chain;
}

const VALID_KEY_ROW = {
  facility_id: FACILITY_UUID,
  scopes: ['bookings:read'],
  is_active: true,
  expires_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Auth guards ──────────────────────────────────────────────────────────────

test('Authorizationヘッダーなし → 401', async () => {
  const req = new NextRequest('http://localhost/api/v1/bookings', { method: 'GET' });
  const res = await GET(req);
  expect(res.status).toBe(401);
});

test('Bearer プレフィックスなし → 401', async () => {
  const req = new NextRequest('http://localhost/api/v1/bookings', {
    method: 'GET',
    headers: { Authorization: 'Basic abc123' },
  });
  const res = await GET(req);
  expect(res.status).toBe(401);
});

test('存在しないAPIキー → 401', async () => {
  mockFrom.mockReturnValue(apiKeyChain(null));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

test('無効化されたAPIキー (is_active: false) → 401', async () => {
  mockFrom.mockReturnValue(apiKeyChain({ ...VALID_KEY_ROW, is_active: false }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

test('有効期限切れAPIキー → 401', async () => {
  mockFrom.mockReturnValue(apiKeyChain({ ...VALID_KEY_ROW, expires_at: '2020-01-01T00:00:00Z' }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

// ─── Scope enforcement ────────────────────────────────────────────────────────

test('bookings:readスコープなし → 403', async () => {
  mockFrom.mockReturnValue(apiKeyChain({ ...VALID_KEY_ROW, scopes: ['customers:read'] }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('*スコープ → 200 (全権限)', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain({ ...VALID_KEY_ROW, scopes: ['*'] });
    return bookingsChain([], 0);
  });
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
});

// ─── Cross-facility access prevention ────────────────────────────────────────

test('別施設のfacility_id指定 → 403', async () => {
  mockFrom.mockReturnValue(apiKeyChain(VALID_KEY_ROW));
  const res = await GET(makeRequest({ facility_id: 'other-facility-uuid' }));
  expect(res.status).toBe(403);
});

// ─── Input validation ─────────────────────────────────────────────────────────

test('from が不正なフォーマット → 400', async () => {
  mockFrom.mockReturnValue(apiKeyChain(VALID_KEY_ROW));
  const res = await GET(makeRequest({ from: '2026/05/01' }));
  expect(res.status).toBe(400);
});

test('to が不正なフォーマット → 400', async () => {
  mockFrom.mockReturnValue(apiKeyChain(VALID_KEY_ROW));
  const res = await GET(makeRequest({ to: 'yesterday' }));
  expect(res.status).toBe(400);
});

test('status が不正な値 → 400', async () => {
  mockFrom.mockReturnValue(apiKeyChain(VALID_KEY_ROW));
  const res = await GET(makeRequest({ status: 'hack' }));
  expect(res.status).toBe(400);
});

// ─── Rate limit ───────────────────────────────────────────────────────────────

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest());
  expect(res.status).toBe(429);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常フロー → 200 with pagination', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    // The route calls .range() before optional filters (.gte/.lte/.eq), then awaits the result.
    // So .range() must return a thenable proxy that also has filter methods.
    const result = { data: [{ id: '1', booking_date: '2026-05-01', status: 'confirmed' }], error: null, count: 1 };
    const proxy: Record<string, unknown> = {};
    const self = () => proxy;
    proxy.select = self; proxy.eq = self; proxy.order = self;
    proxy.gte = self; proxy.lte = self;
    // .range() returns a thenable proxy so .gte/.lte work after it, and await resolves to result
    proxy.range = () => Object.assign(proxy, { then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn) });
    return proxy;
  });

  const res = await GET(makeRequest({ from: '2026-05-01', to: '2026-05-31' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.api_version).toBe('1.0.0');
  expect(json.pagination.total).toBe(1);
  expect(json.data).toHaveLength(1);
});
