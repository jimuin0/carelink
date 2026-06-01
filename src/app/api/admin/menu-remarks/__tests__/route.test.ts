/**
 * @jest-environment node
 *
 * Tests for GET/PATCH /api/admin/menu-remarks
 * 主要観点:
 *   - 非メンバー → 401（IDOR防止）
 *   - GET: カラム不在(マイグレーション未適用)なら supported:false で返す
 *   - PATCH: 500/400/403/429/正常
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

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
import { GET, PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeGet(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menu-remarks');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}
function makePatch(body: unknown, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menu-remarks');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function selectSingle(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}
function updateChain(error: unknown = null) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ──────────────────────────────────────────────────────────────────────
test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  expect((await GET(makeGet())).status).toBe(429);
});
test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  expect((await GET(makeGet())).status).toBe(401);
});
test('GET: facility_id なし → 401', async () => {
  expect((await GET(makeGet(null))).status).toBe(401);
});
test('GET: facility_id 不正UUID → 401', async () => {
  expect((await GET(makeGet('bad-uuid'))).status).toBe(401);
});
test('GET: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await GET(makeGet())).status).toBe(401);
});
test('GET: 正常 → 200 supported:true', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(selectSingle({ menu_remarks: 'メモ' }));
  const res = await GET(makeGet());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.supported).toBe(true);
  expect(json.menu_remarks).toBe('メモ');
});
test('GET: menu_remarks が null → 空文字', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(selectSingle({ menu_remarks: null }));
  const json = await (await GET(makeGet())).json();
  expect(json.menu_remarks).toBe('');
});
test('GET: カラム不在(error)なら supported:false', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(selectSingle(null, { code: '42703', message: 'column does not exist' }));
  const json = await (await GET(makeGet())).json();
  expect(json.supported).toBe(false);
  expect(json.menu_remarks).toBe('');
});

// ─── PATCH ──────────────────────────────────────────────────────────────────────
test('PATCH: CSRF → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  expect((await PATCH(makePatch({ menu_remarks: 'x' }))).status).toBe(403);
});
test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  expect((await PATCH(makePatch({ menu_remarks: 'x' }))).status).toBe(429);
});
test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  expect((await PATCH(makePatch({ menu_remarks: 'x' }))).status).toBe(401);
});
test('PATCH: 非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  expect((await PATCH(makePatch({ menu_remarks: 'x' }))).status).toBe(401);
});
test('PATCH: バリデーション失敗(501文字) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makePatch({ menu_remarks: 'a'.repeat(501) }))).status).toBe(400);
});
test('PATCH: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makePatch('not-json'))).status).toBe(400);
});
test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  expect((await PATCH(makePatch({ menu_remarks: 'x' }))).status).toBe(500);
});
test('PATCH: 正常更新 → 200 ok:true + 監査ログ', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  const { writeAuditLog } = require('@/lib/audit-logger');
  const res = await PATCH(makePatch({ menu_remarks: 'メニュー備考' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
  await new Promise((r) => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});
test('PATCH: menu_remarks 空→null許容で 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  expect((await PATCH(makePatch({ menu_remarks: '' }))).status).toBe(200);
});
test('PATCH: menu_remarks=null → null 保存で 200（?? null 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(null));
  expect((await PATCH(makePatch({ menu_remarks: null }))).status).toBe(200);
});
