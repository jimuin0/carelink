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

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: facility_ids が空配列 → 400', async () => {
  const res = await POST(makeRequest(validBody({ facility_ids: [] })));
  expect(res.status).toBe(400);
});

test('POST: facility_ids が 50件 → 201', async () => {
  const ids = Array.from({ length: 50 }, (_, i) =>
    `${String(i).padStart(8, '0')}-1234-5678-abcd-000000000000`
  );
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain(ids.map(id => ({ facility_id: id })));
    }
    return insertChain(ids.map(id => ({ id })));
  });
  const res = await POST(makeRequest(validBody({ facility_ids: ids })));
  expect(res.status).toBe(201);
});

test('POST: レートリミット params', async () => {
  setupSuccess();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(validBody()));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBeGreaterThan(0);
  expect(call[2]).toBe(60_000);
});

test('POST: レスポンスが { ok: true, created: N } 形式', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(typeof json.created).toBe('number');
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('POST: name フィールドなし → 400', async () => {
  const res = await POST(makeRequest({ discount_type: 'percent', facility_ids: [FACILITY_A] }));
  expect(res.status).toBe(400);
});

test('POST: discount_type フィールドなし → 400', async () => {
  const res = await POST(makeRequest({ name: 'x', facility_ids: [FACILITY_A] }));
  expect(res.status).toBe(400);
});

test('POST: name が数値 → 400 (typeof check)', async () => {
  const res = await POST(makeRequest(validBody({ name: 123 })));
  expect(res.status).toBe(400);
});

test('POST: discount_value が文字列 → 400 (typeof check)', async () => {
  const res = await POST(makeRequest(validBody({ discount_value: 'invalid' })));
  expect(res.status).toBe(400);
});

test('POST: special_price が文字列 → 400 (typeof check)', async () => {
  const res = await POST(makeRequest(validBody({ discount_type: 'special', special_price: 'invalid' })));
  expect(res.status).toBe(400);
});

test('POST: 不正JSONボディ → 400 (name 欠落扱い)', async () => {
  const req = new NextRequest('http://localhost/api/admin/chain/bulk-coupon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid {',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: coupon_type=first_visit 指定 → 201', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ coupon_type: 'first_visit' })));
  expect(res.status).toBe(201);
});

test('POST: coupon_type=invalid → 201 (default "all" にフォールバック)', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ coupon_type: 'invalid_type' })));
  expect(res.status).toBe(201);
});

test('POST: valid_from/until 指定 → 201', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({
    valid_from: '2026-01-01',
    valid_until: '2026-12-31',
  })));
  expect(res.status).toBe(201);
});

test('POST: memberships が null → 403', async () => {
  mockAdminFrom.mockImplementation(() =>
    membershipChain(null as unknown as unknown[])
  );
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: insert結果が null → 201 (created=0)', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return insertChain(null);
  });
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.created).toBe(0);
});

// Branch coverage: line 68 — discount_value が undefined のとき ?? null で null になる（true 分岐）
test('POST: discount_value 未指定 (undefined) → null に変換されて 201', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({
    discount_type: 'special',
    special_price: 3000,
    discount_value: undefined,
  })));
  expect(res.status).toBe(201);
});

test('POST: x-forwarded-for ヘッダあり → IP抽出', async () => {
  setupSuccess();
  (inMemoryRateLimit as jest.Mock).mockClear();
  const req = new NextRequest('http://localhost/api/admin/chain/bulk-coupon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
    body: JSON.stringify(validBody()),
  });
  await POST(req);
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('10.0.0.1');
});
