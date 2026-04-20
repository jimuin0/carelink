/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/chain/bulk-coupon
 * Key assertions:
 *   - Partial facility ownership → 403 (all-or-nothing check)
 *   - facility_ids > 50 → 400
 *   - Invalid UUID in array → 400
 *   - Invalid discount_type → 400
 *   - DB insert failure → 500
 *   - Success → 201 with created count
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID   = '33333333-3333-3333-3333-333333333333';
const FACILITY_A = '11111111-1111-1111-1111-111111111111';
const FACILITY_B = '22222222-2222-2222-2222-222222222222';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/chain/bulk-coupon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return {
    name: 'テストクーポン',
    discount_type: 'percent',
    discount_value: 10,
    facility_ids: [FACILITY_A, FACILITY_B],
    ...overrides,
  };
}

function membershipChain(data: unknown[]) {
  const finalIn = jest.fn(() => Promise.resolve({ data, error: null }));
  const firstIn = jest.fn().mockReturnValue({ in: finalIn });
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ in: firstIn }),
    }),
  };
}

function insertChain(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn(() => Promise.resolve({ data, error })),
    }),
  };
}

function setupSuccess() {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return insertChain([{ id: 'aaa' }, { id: 'bbb' }]);
  });
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
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: name が空文字 → 400', async () => {
  const res = await POST(makeRequest(validBody({ name: '' })));
  expect(res.status).toBe(400);
});

test('POST: name が 101文字 → 400', async () => {
  const res = await POST(makeRequest(validBody({ name: 'a'.repeat(101) })));
  expect(res.status).toBe(400);
});

test('POST: facility_ids が 51件 → 400', async () => {
  const ids = Array.from({ length: 51 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-1000-8000-000000000000`
  );
  const res = await POST(makeRequest(validBody({ facility_ids: ids })));
  expect(res.status).toBe(400);
});

test('POST: facility_ids に不正なUUID → 400', async () => {
  const res = await POST(makeRequest(validBody({ facility_ids: ['bad-uuid'] })));
  expect(res.status).toBe(400);
});

test('POST: 不正な discount_type → 400', async () => {
  const res = await POST(makeRequest(validBody({ discount_type: 'free' })));
  expect(res.status).toBe(400);
});

test('POST: discount_value が負数 → 400', async () => {
  const res = await POST(makeRequest(validBody({ discount_value: -1 })));
  expect(res.status).toBe(400);
});

test('POST: special_price が負数 → 400', async () => {
  const res = await POST(makeRequest(validBody({ special_price: -500 })));
  expect(res.status).toBe(400);
});

test('POST: 一部施設が未認可 → 403', async () => {
  // Only FACILITY_A returned — partial ownership → forbidden
  mockAdminFrom.mockImplementation(() =>
    membershipChain([{ facility_id: FACILITY_A }])
  );
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return insertChain(null, { message: 'DB error' });
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with created count', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.ok).toBe(true);
  expect(json.created).toBe(2);
});

test('POST: discount_type が fixed → 201', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ discount_type: 'fixed', discount_value: 500 })));
  expect(res.status).toBe(201);
});

test('POST: discount_type が special → 201', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ discount_type: 'special', special_price: 3000 })));
  expect(res.status).toBe(201);
});
