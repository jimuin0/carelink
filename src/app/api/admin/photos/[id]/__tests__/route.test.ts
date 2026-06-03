/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/photos/[id]
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const PHOTO_UUID = '44444444-4444-4444-4444-444444444444';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
const mockStorageRemove = jest.fn(() => Promise.resolve({ error: null }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom, storage: { from: () => ({ remove: mockStorageRemove }) } }) }));

import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeReq(method: string, body?: object) {
  return new NextRequest('http://localhost/api/admin/photos/' + PHOTO_UUID, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
function makeProps(id = PHOTO_UUID) { return { params: Promise.resolve({ id }) }; }
function single(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error })) };
}
function updateChain(data: unknown, error: unknown = null) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) }) }) };
}
function deleteChain(error: unknown = null) {
  return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }) };
}
// DELETE は pre-delete の select(photo_url).maybeSingle() と delete() の双方を呼ぶため両対応のチェーン
function deleteWithRow(photoUrl: string | null, error: unknown = null) {
  return {
    select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn(() => Promise.resolve({ data: { photo_url: photoUrl } })) }) }) }),
    delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }),
  };
}
// admin: 1st call = photo lookup (verifyPhotoAdmin), 2nd call = update/delete
function setup(photoData: unknown, memberData: unknown, second?: unknown) {
  let n = 0;
  mockAdminFrom.mockImplementation(() => { n++; if (n === 1) return single(photoData); return second as object; });
  mockAnonFrom.mockReturnValue(single(memberData));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

// PATCH
test('PATCH: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(403); });
test('PATCH: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await PATCH(makeReq('PATCH', {}), makeProps())).status).toBe(429); });
test('PATCH: 不正UUID → 400', async () => { expect((await PATCH(makeReq('PATCH', {}), makeProps('bad'))).status).toBe(400); });
test('PATCH: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await PATCH(makeReq('PATCH', {}), makeProps())).status).toBe(401); });
test('PATCH: 写真が存在しない → 401', async () => { setup(null, { facility_id: FACILITY_UUID }); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(401); });
test('PATCH: 非メンバー → 401', async () => { setup({ facility_id: FACILITY_UUID }, null); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(401); });
test('PATCH: バリデーション失敗 → 400', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }); expect((await PATCH(makeReq('PATCH', { photo_type: 'invalid' }), makeProps())).status).toBe(400); });
test('PATCH: DB更新失敗 → 500', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain(null, { message: 'e' })); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(500); });
test('PATCH: data なし → 404', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain(null)); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(404); });
test('PATCH: 正常 → 200', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: PHOTO_UUID })); expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(200); });

// DELETE
test('DELETE: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(403); });
test('DELETE: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(429); });
test('DELETE: 不正UUID → 400', async () => { expect((await DELETE(makeReq('DELETE'), makeProps('bad'))).status).toBe(400); });
test('DELETE: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(401); });
test('DELETE: 非権限 → 401', async () => { setup(null, { facility_id: FACILITY_UUID }); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(401); });
test('DELETE: DB削除失敗 → 500', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, deleteWithRow(null, { message: 'e' })); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(500); });
test('DELETE: 正常(photo_url=null/data URI) → 200・Storage削除なし', async () => { mockStorageRemove.mockClear(); setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, deleteWithRow(null)); expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(200); expect(mockStorageRemove).not.toHaveBeenCalled(); });
test('DELETE: 正常(carelink-uploads URL) → 200・Storage実体も削除(#06)', async () => {
  mockStorageRemove.mockClear();
  setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, deleteWithRow('https://x.supabase.co/storage/v1/object/public/carelink-uploads/salons/abc/p.jpg'));
  expect((await DELETE(makeReq('DELETE'), makeProps())).status).toBe(200);
  expect(mockStorageRemove).toHaveBeenCalledWith(['salons/abc/p.jpg']);
});

// ─── 拡張カラム不在フォールバック（#22）＋ coupon_id 施設検証（#3） ─────────────
function scopeRow(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data })) };
}
const VALID_COUPON = '88888888-8888-4888-8888-888888888888';

test('PATCH: 拡張カラム不在(PGRST204)→除外して再試行し 200', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return single({ facility_id: FACILITY_UUID }); // photo lookup
    if (n === 2) return updateChain(null, { code: 'PGRST204', message: 'column does not exist' });
    return updateChain({ id: PHOTO_UUID });
  });
  mockAnonFrom.mockReturnValue(single({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makeReq('PATCH', { caption: 'x' }), makeProps())).status).toBe(200);
});

test('PATCH: coupon_id が他施設 → 400', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => { n++; if (n === 1) return single({ facility_id: FACILITY_UUID }); return scopeRow(null); });
  mockAnonFrom.mockReturnValue(single({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makeReq('PATCH', { coupon_id: VALID_COUPON }), makeProps())).status).toBe(400);
});

test('PATCH: coupon_id が自施設 → 200', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => { n++; if (n === 1) return single({ facility_id: FACILITY_UUID }); if (n === 2) return scopeRow({ id: VALID_COUPON }); return updateChain({ id: PHOTO_UUID }); });
  mockAnonFrom.mockReturnValue(single({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makeReq('PATCH', { coupon_id: VALID_COUPON }), makeProps())).status).toBe(200);
});
