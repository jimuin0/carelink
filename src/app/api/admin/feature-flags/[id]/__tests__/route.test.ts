/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/feature-flags/[id]
 * Key assertions:
 *   - Non-platform-admin → 403 (platform-wide gates must be locked down)
 *   - Authenticated but non-admin → 403 (role escalation prevention)
 *   - rollout_pct clamped to 0-100 by Zod
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test', ip: '127.0.0.1' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FLAG_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(body: object = { enabled: true }) {
  return new Request(`http://localhost/api/admin/feature-flags/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = FLAG_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 403 (platform admin required)', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest(), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

// ─── Platform-admin only ──────────────────────────────────────────────────────

test('認証済み + is_platform_admin: false → 403 (一般adminもアクセス不可)', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: false }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('認証済み + profileが存在しない → 403', async () => {
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('rollout_pct > 100 → 400', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  const res = await PATCH(makeRequest({ rollout_pct: 101 }), makeProps());
  expect(res.status).toBe(400);
});

test('rollout_pct < 0 → 400', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  const res = await PATCH(makeRequest({ rollout_pct: -1 }), makeProps());
  expect(res.status).toBe(400);
});

test('enabled が boolean でない → 400', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  const res = await PATCH(makeRequest({ enabled: 'yes' }), makeProps());
  expect(res.status).toBe(400);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('platform admin + valid body → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ enabled: false, rollout_pct: 50 }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('UPDATE DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makeRequest({ enabled: true }), makeProps());
  expect(res.status).toBe(500);
});

test('rollout_pct: 0 と 100 は有効（境界値）', async () => {
  mockAnonFrom.mockReturnValue(singleChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain());

  const res0 = await PATCH(makeRequest({ rollout_pct: 0 }), makeProps());
  expect(res0.status).toBe(200);

  mockAdminFrom.mockReturnValue(updateChain());
  const res100 = await PATCH(makeRequest({ rollout_pct: 100 }), makeProps());
  expect(res100.status).toBe(200);
});
