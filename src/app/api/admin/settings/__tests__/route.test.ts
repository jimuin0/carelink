/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/settings
 * Key assertions:
 *   - Non-admin → 401 (IDOR prevention)
 *   - Business hours: close <= open → 400
 *   - ?action=status: published/suspended/draft transitions
 *   - DB update failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
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

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const VALID_BODY = { name: 'テスト施設' };

function makePatchRequest(body: object = VALID_BODY, params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/settings');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
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
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makePatchRequest(VALID_BODY, {}));
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(429);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('PATCH: name 空文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '' }));
  expect(res.status).toBe(400);
});

test('PATCH: business_hours で close <= open → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '18:00', close: '09:00' } },
  }));
  expect(res.status).toBe(400);
});

test('PATCH: booking_buffer_minutes > 120 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', booking_buffer_minutes: 121 }));
  expect(res.status).toBe(400);
});

// ─── Status action ────────────────────────────────────────────────────────────

test('PATCH: ?action=status published → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: ?action=status 無効なステータス → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ status: 'deleted' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(400);
});

test('PATCH: ?action=status DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('PATCH: 正常更新 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '更新施設', booking_auto_confirm: true }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ name: 'test' }));
  expect(res.status).toBe(500);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(403);
});

test('PATCH: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makePatchRequest({ name: '施設名' }));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await PATCH(makePatchRequest({ name: '施設名' }));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('PATCH: ?action=status suspended → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: ?action=status draft → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'draft' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: website_url が有効URL → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: 'https://example.com' }));
  expect(res.status).toBe(200);
});

test('PATCH: booking_buffer_minutes が 120 (上限ぴったり) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', booking_buffer_minutes: 120 }));
  expect(res.status).toBe(200);
});
