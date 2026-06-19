/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/hpb-menus/apply
 *   - 認可(未認証/facility_id無/不正UUID/非メンバー→401・IDOR防止)・rate limit・CSRF
 *   - 反映成功→counts / 反映中の例外→500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/hpb-menu', () => ({
  applyHpbMenusToFacilityMenus: jest.fn(),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { applyHpbMenusToFacilityMenus } from '@/lib/hpb-menu';

function makeReq(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/hpb-menus/apply');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST' });
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('CSRF → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }),
  );
  expect((await POST(makeReq())).status).toBe(403);
});

test('rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await POST(makeReq())).status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  expect((await POST(makeReq())).status).toBe(401);
});

test('facility_id なし → 401', async () => {
  expect((await POST(makeReq(null))).status).toBe(401);
});

test('不正UUID → 401', async () => {
  expect((await POST(makeReq('bad'))).status).toBe(401);
});

test('非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await POST(makeReq())).status).toBe(401);
});

test('反映成功 → 200 with counts', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (applyHpbMenusToFacilityMenus as jest.Mock).mockResolvedValue({
    inserted: 3,
    updated: 2,
    hidden: 1,
    skipped: 0,
  });
  const res = await POST(makeReq());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json).toEqual({ inserted: 3, updated: 2, hidden: 1, skipped: 0 });
});

test('反映中の例外 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (applyHpbMenusToFacilityMenus as jest.Mock).mockRejectedValue(new Error('db error'));
  expect((await POST(makeReq())).status).toBe(500);
});
