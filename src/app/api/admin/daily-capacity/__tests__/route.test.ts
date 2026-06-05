/**
 * @jest-environment node
 *
 * Tests for GET/PUT/DELETE /api/admin/daily-capacity（受付可能枠数 日別 #05/#46）
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
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function url(params: Record<string, string>) {
  const u = new URL('http://localhost/api/admin/daily-capacity');
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
const base = { facility_id: FACILITY_UUID };
function getReq(p: Record<string, string> = base) { return new NextRequest(url(p), { method: 'GET' }); }
function putReq(body: unknown, p: Record<string, string> = base) { return new NextRequest(url(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }); }
function delReq(p: Record<string, string> = { ...base, date: '2026-07-01' }) { return new NextRequest(url(p), { method: 'DELETE' }); }

function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
// GET: select().eq().gte?().lte?().order() の chainable thenable
function listChain(data: unknown[] | null, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data, error })) };
}
function upsertChain(data: unknown, error: unknown = null) {
  return { upsert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}
function deleteChain(error: unknown = null) {
  return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }) };
}

const VALID = { capacity_date: '2026-07-01', max_bookings: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
});

// ── GET ──
test('GET: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await GET(getReq())).status).toBe(429); });
test('GET: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await GET(getReq())).status).toBe(401); });
test('GET: facility_id 不正 → 401', async () => { expect((await GET(getReq({ facility_id: 'bad' }))).status).toBe(401); });
test('GET: 非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await GET(getReq())).status).toBe(401); });
test('GET: data null でも 200（空配列）', async () => { mockAdminFrom.mockReturnValue(listChain(null)); const r = await GET(getReq()); expect(r.status).toBe(200); expect((await r.json()).capacities).toEqual([]); });
test('GET: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(listChain(null, { message: 'e' })); expect((await GET(getReq())).status).toBe(500); });
test('GET: from/to なし → 200', async () => { mockAdminFrom.mockReturnValue(listChain([{ capacity_date: '2026-07-01', max_bookings: 5 }])); const r = await GET(getReq()); expect(r.status).toBe(200); expect((await r.json()).capacities).toHaveLength(1); });
test('GET: from/to 指定 → 200（範囲絞り込み）', async () => { mockAdminFrom.mockReturnValue(listChain([])); const r = await GET(getReq({ ...base, from: '2026-07-01', to: '2026-07-31' })); expect(r.status).toBe(200); });
test('GET: from/to 不正形式 → 200（無視して全件）', async () => { mockAdminFrom.mockReturnValue(listChain([])); const r = await GET(getReq({ ...base, from: 'bad', to: 'bad' })); expect(r.status).toBe(200); });

// ── PUT ──
test('PUT: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await PUT(putReq(VALID))).status).toBe(403); });
test('PUT: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await PUT(putReq(VALID))).status).toBe(429); });
test('PUT: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await PUT(putReq(VALID))).status).toBe(401); });
test('PUT: 不正JSON → 400', async () => { expect((await PUT(putReq('x'))).status).toBe(400); });
test('PUT: 日付不正 → 400', async () => { expect((await PUT(putReq({ ...VALID, capacity_date: '2026-02-30' }))).status).toBe(400); });
test('PUT: max_bookings 負 → 400', async () => { expect((await PUT(putReq({ ...VALID, max_bookings: -1 }))).status).toBe(400); });
test('PUT: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(upsertChain(null, { message: 'e' })); expect((await PUT(putReq(VALID))).status).toBe(500); });
test('PUT: 正常 → 200', async () => { mockAdminFrom.mockReturnValue(upsertChain(VALID)); const r = await PUT(putReq(VALID)); expect(r.status).toBe(200); expect((await r.json()).capacity.max_bookings).toBe(5); });
test('PUT: upsert に facility_id スコープと onConflict が渡る（IDOR/一意性の固定）', async () => {
  const upsert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: VALID, error: null })) }) });
  mockAdminFrom.mockReturnValue({ upsert });
  await PUT(putReq(VALID));
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ facility_id: FACILITY_UUID, capacity_date: '2026-07-01', max_bookings: 5 }), { onConflict: 'facility_id,capacity_date' });
});

// ── DELETE ──
test('DELETE: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await DELETE(delReq())).status).toBe(403); });
test('DELETE: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await DELETE(delReq())).status).toBe(429); });
test('DELETE: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await DELETE(delReq())).status).toBe(401); });
test('DELETE: date なし → 400', async () => { expect((await DELETE(delReq(base))).status).toBe(400); });
test('DELETE: date 不正 → 400', async () => { expect((await DELETE(delReq({ ...base, date: 'bad' }))).status).toBe(400); });
test('DELETE: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(deleteChain({ message: 'e' })); expect((await DELETE(delReq())).status).toBe(500); });
test('DELETE: 正常 → 200', async () => { mockAdminFrom.mockReturnValue(deleteChain()); const r = await DELETE(delReq()); expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true); });
test('DELETE: WHERE に facility_id と capacity_date が含まれる（他施設の枠を消せない＝IDOR防御）', async () => {
  const eqDate = jest.fn(() => Promise.resolve({ error: null }));
  const eqFac = jest.fn().mockReturnValue({ eq: eqDate });
  mockAdminFrom.mockReturnValue({ delete: jest.fn().mockReturnValue({ eq: eqFac }) });
  await DELETE(delReq());
  expect(eqFac).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
  expect(eqDate).toHaveBeenCalledWith('capacity_date', '2026-07-01');
});
