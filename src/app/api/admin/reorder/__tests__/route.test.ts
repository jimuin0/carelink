/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/reorder（並び替え原子化 #13/#14）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ID1 = '44444444-4444-4444-8444-444444444444';
const ID2 = '55555555-5555-4555-8555-555555555555';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminRpc = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockAdminRpc }) }));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeReq(body: unknown, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/reorder');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
const VALID = { entity: 'photos', ids: [ID1, ID2] };

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminRpc.mockResolvedValue({ error: null });
});

test('CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await POST(makeReq(VALID))).status).toBe(403); });
test('レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await POST(makeReq(VALID))).status).toBe(429); });
test('未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await POST(makeReq(VALID))).status).toBe(401); });
test('facility_id なし → 401', async () => { expect((await POST(makeReq(VALID, null))).status).toBe(401); });
test('facility_id 不正 → 401', async () => { expect((await POST(makeReq(VALID, 'bad'))).status).toBe(401); });
test('非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await POST(makeReq(VALID))).status).toBe(401); });
test('不正JSON → 400', async () => { expect((await POST(makeReq('x'))).status).toBe(400); });
test('entity 不正 → 400', async () => { expect((await POST(makeReq({ entity: 'bad', ids: [ID1] }))).status).toBe(400); });
test('ids 空 → 400', async () => { expect((await POST(makeReq({ entity: 'photos', ids: [] }))).status).toBe(400); });
test('ids 非UUID → 400', async () => { expect((await POST(makeReq({ entity: 'photos', ids: ['x'] }))).status).toBe(400); });
test('RPC エラー → 500', async () => { mockAdminRpc.mockResolvedValue({ error: { message: 'e' } }); expect((await POST(makeReq(VALID))).status).toBe(500); });
test('正常(photos) → 200 と RPC 呼び出し', async () => {
  const r = await POST(makeReq(VALID));
  expect(r.status).toBe(200);
  expect(mockAdminRpc).toHaveBeenCalledWith('reorder_facility_photos', { p_facility_id: FACILITY_UUID, p_ids: [ID1, ID2] });
});
test('正常(coupons) → reorder_coupons', async () => { await POST(makeReq({ entity: 'coupons', ids: [ID1] })); expect(mockAdminRpc).toHaveBeenCalledWith('reorder_coupons', { p_facility_id: FACILITY_UUID, p_ids: [ID1] }); });
test('正常(menus) → reorder_facility_menus', async () => { await POST(makeReq({ entity: 'menus', ids: [ID1] })); expect(mockAdminRpc).toHaveBeenCalledWith('reorder_facility_menus', { p_facility_id: FACILITY_UUID, p_ids: [ID1] }); });
