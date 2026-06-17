/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/inquiries/[id]
 * contacts はプラットフォーム宛の問い合わせ（facility_id 列なし）。
 * 認可はプラットフォーム管理者（profiles.is_platform_admin）。更新は id のみ。
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const INQUIRY_UUID = '11111111-1111-1111-1111-111111111111';
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
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object = { ticket_status: 'in_progress' }) {
  return new NextRequest(`http://localhost/api/admin/inquiries/${INQUIRY_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = INQUIRY_UUID) {
  return { params: Promise.resolve({ id }) };
}

// getPlatformAdminUser() の profiles.select('is_platform_admin').eq('id').single() 用
function profileChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// update().eq('id') のみ（facility_id 絞りは廃止）
function updateChain(error: unknown = null) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 非プラットフォーム管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: false }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: profile が null → 401', async () => {
  mockAnonFrom.mockReturnValue(profileChain(null));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なticket_status → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  const res = await PATCH(makeRequest({ ticket_status: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: 不正なpriority → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  const res = await PATCH(makeRequest({ priority: 'critical' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: UPDATEのWHEREが id のみ（facility_id 絞りは廃止）', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  const eqMock = jest.fn(() => Promise.resolve({ error: null }));
  const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
  mockAdminFrom.mockReturnValue({ update: updateMock });

  await PATCH(makeRequest({ ticket_status: 'resolved' }), makeProps());
  expect(eqMock).toHaveBeenCalledWith('id', INQUIRY_UUID);
  expect(eqMock).toHaveBeenCalledTimes(1);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  const res = await PATCH(makeRequest({ ticket_status: 'in_progress' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: ticket_status=resolved → 200（resolved_at 付与経路）', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  const res = await PATCH(makeRequest({ ticket_status: 'resolved' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: priority=high → 200', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  const res = await PATCH(makeRequest({ priority: 'high' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(profileChain({ is_platform_admin: true }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  (checkRateLimit as jest.Mock).mockClear();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  await PATCH(makeRequest(), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
});
