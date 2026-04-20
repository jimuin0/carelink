/**
 * @jest-environment node
 *
 * Tests for GET /api/v1/customers
 * Key assertions:
 *   - API key scope enforcement (customers:read required)
 *   - Customer deduplication (same user_id/phone appears once)
 *   - Search injection prevention (special chars sanitized before .or() query)
 *   - Pagination clamping (limit max 100, page max 10000)
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

const VALID_KEY_ROW = {
  facility_id: FACILITY_UUID,
  scopes: ['customers:read'],
  is_active: true,
  expires_at: null,
};

function makeRequest(params: Record<string, string> = {}, apiKey = 'valid-api-key') {
  const url = new URL('http://localhost/api/v1/customers');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function apiKeyChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// Returns a fluent chain that resolves on .range()
function bookingsChain(data: unknown[], count = data.length) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self; chain.eq = self; chain.not = self;
  chain.order = self; chain.or = self;
  chain.range = jest.fn(() => Promise.resolve({ data, error: null, count }));
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Auth guards ──────────────────────────────────────────────────────────────

test('Authorizationヘッダーなし → 401', async () => {
  const req = new NextRequest('http://localhost/api/v1/customers', { method: 'GET' });
  const res = await GET(req);
  expect(res.status).toBe(401);
});

test('存在しないAPIキー → 401', async () => {
  mockFrom.mockReturnValue(apiKeyChain(null));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

test('無効化されたキー → 401', async () => {
  mockFrom.mockReturnValue(apiKeyChain({ ...VALID_KEY_ROW, is_active: false }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

// ─── Scope enforcement ────────────────────────────────────────────────────────

test('customers:readスコープなし → 403', async () => {
  mockFrom.mockReturnValue(apiKeyChain({ ...VALID_KEY_ROW, scopes: ['bookings:read'] }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('*スコープ → 200', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain({ ...VALID_KEY_ROW, scopes: ['*'] });
    return bookingsChain([]);
  });
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
});

// ─── Rate limit ───────────────────────────────────────────────────────────────

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest());
  expect(res.status).toBe(429);
});

// ─── Happy path + deduplication ──────────────────────────────────────────────

test('顧客の重複除去: 同一user_idは1件のみ', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    return bookingsChain([
      { customer_name: '田中太郎', customer_phone: '090-0001', customer_email: null, user_id: 'user-A' },
      { customer_name: '田中太郎2', customer_phone: '090-0001-dup', customer_email: null, user_id: 'user-A' }, // duplicate
      { customer_name: '佐藤花子', customer_phone: '090-0002', customer_email: null, user_id: 'user-B' },
    ], 3);
  });

  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  // user-A appears twice → deduplicated to 1
  expect(json.data).toHaveLength(2);
});

test('電話番号で重複除去', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    return bookingsChain([
      { customer_name: '山田一郎', customer_phone: '090-9999', customer_email: null, user_id: null },
      { customer_name: '山田一郎', customer_phone: '090-9999', customer_email: null, user_id: null }, // dup by phone
    ], 2);
  });

  const res = await GET(makeRequest());
  const json = await res.json();
  expect(json.data).toHaveLength(1);
});

test('正常フロー → 200 with api_version and pagination', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    return bookingsChain([
      { customer_name: '顧客A', customer_phone: '090-1111', customer_email: 'a@example.com', user_id: 'u1' },
    ], 1);
  });

  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.api_version).toBe('1.0.0');
  expect(json.pagination.total).toBe(1);
  expect(json.data[0]).toEqual({ name: '顧客A', phone: '090-1111', email: 'a@example.com' });
});

// ─── Search sanitization ──────────────────────────────────────────────────────

test('検索クエリのSQLワイルドカード文字をエスケープ', async () => {
  let callNum = 0;
  let capturedOrArg: string | null = null;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self; chain.eq = self; chain.not = self; chain.order = self;
    chain.or = jest.fn((arg: string) => { capturedOrArg = arg; return chain; });
    chain.range = jest.fn(() => Promise.resolve({ data: [], error: null, count: 0 }));
    return chain;
  });

  await GET(makeRequest({ search: '100%_off' }));
  // % and _ should be escaped in the ilike pattern
  expect(capturedOrArg).toContain('\\%');
  expect(capturedOrArg).toContain('\\_');
});

test('limit の最大値クランプ (100超は100に)', async () => {
  let callNum = 0;
  let capturedRangeArgs: [number, number] | null = null;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return apiKeyChain(VALID_KEY_ROW);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self; chain.eq = self; chain.not = self; chain.order = self; chain.or = self;
    chain.range = jest.fn((from: number, to: number) => { capturedRangeArgs = [from, to]; return Promise.resolve({ data: [], error: null, count: 0 }); });
    return chain;
  });

  await GET(makeRequest({ limit: '9999', page: '1' }));
  // range(0, 99) → limit clamped to 100
  expect(capturedRangeArgs).toEqual([0, 99]);
});
