/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/hpb-menus
 *   - 認可(非メンバー→401・IDOR防止)・rate limit・CSRF
 *   - POST: hpb_sln_id 未設定→400 / 取得成功→counts
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/hpb-menu', () => ({
  listHpbMenus: jest.fn(),
  scrapeAndSaveFacility: jest.fn(),
  setFacilitySlnId: jest.fn(),
  updateHpbMenuOverride: jest.fn(),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
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
import { GET, POST, PUT, PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  listHpbMenus,
  scrapeAndSaveFacility,
  setFacilitySlnId,
  updateHpbMenuOverride,
} from '@/lib/hpb-menu';

function makeReq(method: string, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/hpb-menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method });
}

function makeBodyReq(method: string, body: unknown, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/hpb-menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ───
test('GET: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await GET(makeReq('GET'))).status).toBe(429);
});

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  expect((await GET(makeReq('GET'))).status).toBe(401);
});

test('GET: facility_id なし → 401', async () => {
  expect((await GET(makeReq('GET', null))).status).toBe(401);
});

test('GET: 不正UUID → 401', async () => {
  expect((await GET(makeReq('GET', 'bad'))).status).toBe(401);
});

test('GET: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await GET(makeReq('GET'))).status).toBe(401);
});

test('GET: listHpbMenus が null → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (listHpbMenus as jest.Mock).mockResolvedValue(null);
  expect((await GET(makeReq('GET'))).status).toBe(500);
});

test('GET: 正常 → 200 with menus', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (listHpbMenus as jest.Mock).mockResolvedValue([{ ref_id: 'CP1' }]);
  const res = await GET(makeReq('GET'));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.menus).toEqual([{ ref_id: 'CP1' }]);
});

// ─── POST ───
test('POST: CSRF → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }),
  );
  expect((await POST(makeReq('POST'))).status).toBe(403);
});

test('POST: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await POST(makeReq('POST'))).status).toBe(429);
});

test('POST: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await POST(makeReq('POST'))).status).toBe(401);
});

test('POST: hpb_sln_id 未設定 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({
    slnId: null,
    fetched: 0,
    ok: 0,
    skipped: 0,
    failed: 0,
  });
  expect((await POST(makeReq('POST'))).status).toBe(400);
});

test('POST: 取得成功 → 200 with counts', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({
    slnId: 'H1',
    fetched: 10,
    ok: 8,
    skipped: 2,
    failed: 0,
  });
  const res = await POST(makeReq('POST'));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json).toEqual({ sln_id: 'H1', fetched: 10, saved: 8, skipped: 2, failed: 0 });
});

// ─── PUT (hpb_sln_id 設定) ───
test('PUT: CSRF → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
  expect((await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H1' }))).status).toBe(403);
});

test('PUT: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H1' }))).status).toBe(429);
});

test('PUT: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H1' }))).status).toBe(401);
});

test('PUT: 不正な店舗ID(記号) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H 1!' }))).status).toBe(400);
});

test('PUT: 正常(英数字) → 200 set', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (setFacilitySlnId as jest.Mock).mockResolvedValue(true);
  const res = await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H000537368' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hpb_sln_id: 'H000537368' });
});

test('PUT: 空文字 → 200 で null(未設定に戻す)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (setFacilitySlnId as jest.Mock).mockResolvedValue(true);
  const res = await PUT(makeBodyReq('PUT', { hpb_sln_id: '' }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hpb_sln_id: null });
  expect(setFacilitySlnId).toHaveBeenCalledWith(expect.anything(), FACILITY_UUID, null);
});

test('PUT: setFacilitySlnId 失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (setFacilitySlnId as jest.Mock).mockResolvedValue(false);
  expect((await PUT(makeBodyReq('PUT', { hpb_sln_id: 'H1' }))).status).toBe(500);
});

// ─── PATCH (手直し override / is_hidden) ───
test('PATCH: CSRF → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
  expect((await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1', is_hidden: true }))).status).toBe(403);
});

test('PATCH: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1', is_hidden: true }))).status).toBe(429);
});

test('PATCH: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1', is_hidden: true }))).status).toBe(401);
});

test('PATCH: 不正body(ref_id無し) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makeBodyReq('PATCH', { is_hidden: true }))).status).toBe(400);
});

test('PATCH: 更新項目なし(ref_idのみ) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1' }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('更新する項目がありません');
  expect(updateHpbMenuOverride).not.toHaveBeenCalled();
});

test('PATCH: 全項目指定で更新成功 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (updateHpbMenuOverride as jest.Mock).mockResolvedValue({ ok: true, notFound: false });
  const res = await PATCH(makeBodyReq('PATCH', {
    ref_id: 'CP1',
    name_override: '新名前',
    duration_min_override: 70,
    price_override: 6900,
    description_override: '説明',
    is_hidden: false,
  }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  const patch = (updateHpbMenuOverride as jest.Mock).mock.calls[0][3];
  expect(patch).toEqual({
    name_override: '新名前',
    duration_min_override: 70,
    price_override: 6900,
    description_override: '説明',
    is_hidden: false,
  });
});

test('PATCH: 該当なし → 404', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (updateHpbMenuOverride as jest.Mock).mockResolvedValue({ ok: false, notFound: true });
  expect((await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1', is_hidden: true }))).status).toBe(404);
});

test('PATCH: DBエラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  (updateHpbMenuOverride as jest.Mock).mockResolvedValue({ ok: false, notFound: false });
  expect((await PATCH(makeBodyReq('PATCH', { ref_id: 'CP1', name_override: null }))).status).toBe(500);
});
