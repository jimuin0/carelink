/**
 * @jest-environment node
 *
 * Tests for DELETE /api/admin/blog-authors/[id]
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const AUTHOR_UUID = '66666666-6666-6666-6666-666666666666';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

import { NextRequest } from 'next/server';
import { DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeReq() { return new NextRequest('http://localhost/api/admin/blog-authors/' + AUTHOR_UUID, { method: 'DELETE' }); }
function makeProps(id = AUTHOR_UUID) { return { params: Promise.resolve({ id }) }; }
function single(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function deleteChain(error: unknown = null) {
  return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }) };
}
function setup(authorData: unknown, memberData: unknown, second?: unknown) {
  let n = 0;
  mockAdminFrom.mockImplementation(() => { n++; if (n === 1) return single(authorData); return second as object; });
  mockAnonFrom.mockReturnValue(single(memberData));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

test('CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await DELETE(makeReq(), makeProps())).status).toBe(403); });
test('レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await DELETE(makeReq(), makeProps())).status).toBe(429); });
test('不正UUID → 400', async () => { expect((await DELETE(makeReq(), makeProps('bad'))).status).toBe(400); });
test('未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await DELETE(makeReq(), makeProps())).status).toBe(401); });
test('投稿者が存在しない → 401', async () => { setup(null, { facility_id: FACILITY_UUID }); expect((await DELETE(makeReq(), makeProps())).status).toBe(401); });
test('非メンバー → 401', async () => { setup({ facility_id: FACILITY_UUID }, null); expect((await DELETE(makeReq(), makeProps())).status).toBe(401); });
test('DB削除失敗 → 500', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, deleteChain({ message: 'e' })); expect((await DELETE(makeReq(), makeProps())).status).toBe(500); });
test('正常 → 200 deleted', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, deleteChain(null)); const r = await DELETE(makeReq(), makeProps()); expect(r.status).toBe(200); expect((await r.json()).message).toBe('deleted'); });
