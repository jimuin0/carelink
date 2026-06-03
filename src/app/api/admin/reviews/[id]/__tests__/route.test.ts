/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/reviews/[id]（口コミ返信）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const REVIEW_UUID = '55555555-5555-5555-5555-555555555555';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
const mockAdminRpc = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }) }));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeReq(body?: object) {
  return new NextRequest('http://localhost/api/admin/reviews/' + REVIEW_UUID, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
function makeProps(id = REVIEW_UUID) { return { params: Promise.resolve({ id }) }; }
function single(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function updateChain(data: unknown, error: unknown = null) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) }) }) };
}
function setup(reviewData: unknown, memberData: unknown, second?: unknown) {
  let n = 0;
  mockAdminFrom.mockImplementation(() => { n++; if (n === 1) return single(reviewData); return second as object; });
  mockAnonFrom.mockReturnValue(single(memberData));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAdminRpc.mockResolvedValue({ error: null });
});

test('PATCH: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await PATCH(makeReq({ reply: 'x' }), makeProps())).status).toBe(403); });
test('PATCH: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await PATCH(makeReq({}), makeProps())).status).toBe(429); });
test('PATCH: 不正UUID → 400', async () => { expect((await PATCH(makeReq({}), makeProps('bad'))).status).toBe(400); });
test('PATCH: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await PATCH(makeReq({}), makeProps())).status).toBe(401); });
test('PATCH: 口コミが存在しない → 401', async () => { setup(null, { facility_id: FACILITY_UUID }); expect((await PATCH(makeReq({ reply: 'x' }), makeProps())).status).toBe(401); });
test('PATCH: 非メンバー → 401', async () => { setup({ facility_id: FACILITY_UUID }, null); expect((await PATCH(makeReq({ reply: 'x' }), makeProps())).status).toBe(401); });
test('PATCH: バリデーション失敗(status不正) → 400', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }); expect((await PATCH(makeReq({ status: 'bad' }), makeProps())).status).toBe(400); });
test('PATCH: DB更新失敗 → 500', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain(null, { message: 'e' })); expect((await PATCH(makeReq({ reply: 'x' }), makeProps())).status).toBe(500); });
test('PATCH: data なし → 404', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain(null)); expect((await PATCH(makeReq({ reply: 'x' }), makeProps())).status).toBe(404); });
test('PATCH: reply あり → replied_at 設定で 200', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: REVIEW_UUID, reply: 'x' })); expect((await PATCH(makeReq({ reply: '返信します' }), makeProps())).status).toBe(200); });
test('PATCH: reply 空文字 → replied_at null で 200', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: REVIEW_UUID })); expect((await PATCH(makeReq({ reply: '' }), makeProps())).status).toBe(200); });
test('PATCH: status のみ(reply 無し) → 200（replied_at 非設定）', async () => { setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: REVIEW_UUID })); expect((await PATCH(makeReq({ status: 'hidden' }), makeProps())).status).toBe(200); });
test('PATCH: is_pickup のみ → 200（原子RPCで Pick Up を厳密1件に設定 #I）', async () => {
  setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: REVIEW_UUID, is_pickup: true }));
  expect((await PATCH(makeReq({ is_pickup: true }), makeProps())).status).toBe(200);
  // 原子RPCに review_id/facility_id が渡って呼ばれる
  expect(mockAdminRpc).toHaveBeenCalledWith('set_review_pickup_atomic', { p_review_id: REVIEW_UUID, p_facility_id: FACILITY_UUID });
});

test('PATCH: is_pickup RPC 未適用(error)→従来の clear-others にフォールバックして 200', async () => {
  mockAdminRpc.mockResolvedValue({ error: { message: 'function does not exist' } });
  // 主更新チェーン + フォールバック clear-others(.eq.eq.neq) を満たす
  const tail = { select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: REVIEW_UUID, is_pickup: true }, error: null })) }), neq: jest.fn(() => Promise.resolve({ error: null })) };
  const pickupChain = { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(tail) }) }) };
  setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, pickupChain);
  expect((await PATCH(makeReq({ is_pickup: true }), makeProps())).status).toBe(200);
  expect(tail.neq).toHaveBeenCalledWith('id', REVIEW_UUID); // フォールバックの clear-others が自分を除外して実行された
});

test('PATCH: is_pickup=false → RPC を呼ばず 200（解除は競合対象外）', async () => {
  setup({ facility_id: FACILITY_UUID }, { facility_id: FACILITY_UUID }, updateChain({ id: REVIEW_UUID, is_pickup: false }));
  expect((await PATCH(makeReq({ is_pickup: false }), makeProps())).status).toBe(200);
  expect(mockAdminRpc).not.toHaveBeenCalled();
});

// ─── 拡張カラム不在フォールバック（#23） ──────────────────────────────────────
test('PATCH: reply/replied_at カラム不在(PGRST204)→除外して再試行し 200', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return single({ facility_id: FACILITY_UUID }); // review lookup
    if (n === 2) return updateChain(null, { code: 'PGRST204', message: 'column does not exist' });
    return updateChain({ id: REVIEW_UUID });
  });
  mockAnonFrom.mockReturnValue(single({ facility_id: FACILITY_UUID }));
  expect((await PATCH(makeReq({ reply: '返信' }), makeProps())).status).toBe(200);
});
