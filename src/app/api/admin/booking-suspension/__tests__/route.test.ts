/**
 * @jest-environment node
 *
 * Tests for GET/POST/DELETE /api/admin/booking-suspension（時間帯指定の一括停止 #03/#09/#10）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const SUS_UUID = '44444444-4444-4444-4444-444444444444';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function url(params: Record<string, string>) {
  const u = new URL('http://localhost/api/admin/booking-suspension');
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
const baseParams = { facility_id: FACILITY_UUID };
function getReq(p: Record<string, string> = baseParams) { return new NextRequest(url(p), { method: 'GET' }); }
function postReq(body: unknown, p: Record<string, string> = baseParams) { return new NextRequest(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }); }
function delReq(p: Record<string, string> = { ...baseParams, id: SUS_UUID }) { return new NextRequest(url(p), { method: 'DELETE' }); }

function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function listChain(data: unknown[] | null, error: unknown = null) {
  const c = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), then: (r: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(r) };
  return c;
}
function insertChain(data: unknown, error: unknown = null) {
  return { insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}
function deleteChain(error: unknown = null) {
  return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }) };
}

const VALID_BODY = { suspend_date: '2026-07-01', start_time: '12:00', end_time: '13:00' };

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
test('GET: facility_id なし → 401', async () => { expect((await GET(getReq({}))).status).toBe(401); });
test('GET: facility_id 不正 → 401', async () => { expect((await GET(getReq({ facility_id: 'bad' }))).status).toBe(401); });
test('GET: 非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await GET(getReq())).status).toBe(401); });
test('GET: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(listChain(null, { message: 'e' })); expect((await GET(getReq())).status).toBe(500); });
test('GET: 正常 → 200', async () => { mockAdminFrom.mockReturnValue(listChain([{ id: SUS_UUID, suspend_date: '2026-07-01', start_time: '12:00', end_time: '13:00' }])); const r = await GET(getReq()); expect(r.status).toBe(200); expect((await r.json()).suspensions).toHaveLength(1); });
test('GET: data null でも 200（空配列）', async () => { mockAdminFrom.mockReturnValue(listChain(null)); const r = await GET(getReq()); expect(r.status).toBe(200); expect((await r.json()).suspensions).toEqual([]); });

// ── POST ──
test('POST: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await POST(postReq(VALID_BODY))).status).toBe(403); });
test('POST: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await POST(postReq(VALID_BODY))).status).toBe(429); });
test('POST: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await POST(postReq(VALID_BODY))).status).toBe(401); });
test('POST: 不正JSON → 400', async () => { expect((await POST(postReq('x'))).status).toBe(400); });
test('POST: 日付不正(2026-02-30) → 400', async () => { expect((await POST(postReq({ ...VALID_BODY, suspend_date: '2026-02-30' }))).status).toBe(400); });
test('POST: 開始>=終了 → 400', async () => { expect((await POST(postReq({ ...VALID_BODY, start_time: '13:00', end_time: '12:00' }))).status).toBe(400); });
test('POST: 時刻形式不正 → 400', async () => { expect((await POST(postReq({ ...VALID_BODY, start_time: '9:0' }))).status).toBe(400); });
test('POST: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(insertChain(null, { message: 'e' })); expect((await POST(postReq(VALID_BODY))).status).toBe(500); });
test('POST: 正常 → 201', async () => { mockAdminFrom.mockReturnValue(insertChain({ id: SUS_UUID, ...VALID_BODY })); const r = await POST(postReq(VALID_BODY)); expect(r.status).toBe(201); expect((await r.json()).suspension.id).toBe(SUS_UUID); });
test('POST: insert に facility_id スコープが含まれる（IDOR防御の固定）', async () => {
  const insert = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: SUS_UUID, ...VALID_BODY }, error: null })) }) });
  mockAdminFrom.mockReturnValue({ insert });
  await POST(postReq(VALID_BODY));
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ facility_id: FACILITY_UUID, suspend_date: '2026-07-01', start_time: '12:00', end_time: '13:00' }));
});

// ── DELETE ──
test('DELETE: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await DELETE(delReq())).status).toBe(403); });
test('DELETE: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await DELETE(delReq())).status).toBe(429); });
test('DELETE: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await DELETE(delReq())).status).toBe(401); });
test('DELETE: id なし → 400', async () => { expect((await DELETE(delReq(baseParams))).status).toBe(400); });
test('DELETE: id 不正 → 400', async () => { expect((await DELETE(delReq({ ...baseParams, id: 'bad' }))).status).toBe(400); });
test('DELETE: DBエラー → 500', async () => { mockAdminFrom.mockReturnValue(deleteChain({ message: 'e' })); expect((await DELETE(delReq())).status).toBe(500); });
test('DELETE: 正常 → 200', async () => { mockAdminFrom.mockReturnValue(deleteChain()); const r = await DELETE(delReq()); expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true); });
test('DELETE: WHERE に id と facility_id が含まれる（他施設の停止枠を消せない＝IDOR防御）', async () => {
  const eqFac = jest.fn(() => Promise.resolve({ error: null }));
  const eqId = jest.fn().mockReturnValue({ eq: eqFac });
  mockAdminFrom.mockReturnValue({ delete: jest.fn().mockReturnValue({ eq: eqId }) });
  await DELETE(delReq());
  expect(eqId).toHaveBeenCalledWith('id', SUS_UUID);
  expect(eqFac).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});
