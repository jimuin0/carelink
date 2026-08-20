/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/registrations/[id]
 * Key assertions:
 *   - Non-platform-admin → 403 (role escalation prevention)
 *   - Invalid status value → 400
 *   - DB update failure → 500
 *   - Approved/rejected audit log action
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const SALON_UUID = '11111111-1111-1111-1111-111111111111';
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

import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body?: object) {
  return new Request(`http://localhost/api/admin/registrations/${SALON_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = SALON_UUID) {
  return { params: Promise.resolve({ id }) };
}

function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

// update().eq().select('id') → { data, error }。存在する行の更新は data に1件返る。
// 0 行更新（存在しない id）は data=[] を返し、route は 404 を返す。
function updateChain(error: unknown = null, data: unknown = [{ id: SALON_UUID }]) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

// unclaim 用: select().eq().maybeSingle() と update().eq() の両方を同じ from() 戻り値に持つ。
function unclaimChain(opts: {
  existing?: { id: string; claimed_by_user_id: string | null; claimed_at: string | null } | null;
  fetchError?: unknown;
  updateError?: unknown;
} = {}) {
  const {
    existing = { id: SALON_UUID, claimed_by_user_id: '44444444-4444-4444-4444-444444444444', claimed_at: '2026-08-01T00:00:00Z' },
    fetchError = null,
    updateError = null,
  } = opts;
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn(() => Promise.resolve({ data: existing, error: fetchError })),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error: updateError })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 一般ユーザー (is_platform_admin: false) → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: 不正なstatus → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await PATCH(makeRequest({ status: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 存在しない登録 (0行更新) → 404', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain(null, []));
  const { writeAuditLog } = require('@/lib/audit-logger');
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(404);
  // phantom success 防止: 実在しない登録に対して承認の監査ログを残さない
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('PATCH: approved → 200 success:true', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.status).toBe('approved');
});

test('PATCH: rejected → 200 status:rejected', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ status: 'rejected' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.status).toBe('rejected');
});

test('PATCH: status=pending → 200 success:true', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ status: 'pending' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.status).toBe('pending');
});

test('PATCH: writeAuditLog が approved アクションで呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest({ status: 'approved' }), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve' }));
});

test('PATCH: writeAuditLog が rejected アクションで呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest({ status: 'rejected' }), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'reject' }));
});

test('PATCH: レートリミット params (10/60s)', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makeRequest({ status: 'approved' }), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);
  expect(call[3]).toBe(60_000);
});

test('PATCH: body なし → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 })
  );
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// action:'unclaim'（運営による claim 解除・2026年8月20日 新設）
// requirePlatformAdmin（src/lib/platform-admin.ts）で保護し、writeAuditLog を通す。
// ---------------------------------------------------------------------------

test('PATCH unclaim: 非プラットフォーム管理者 → 403（claim は焼かれない）', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const chain = unclaimChain();
  mockAdminFrom.mockReturnValue(chain);
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(403);
  // 403 で弾かれた場合、DB へは一切触れない（select/update いずれも呼ばれない）。
  expect(chain.select).not.toHaveBeenCalled();
  expect(chain.update).not.toHaveBeenCalled();
});

test('PATCH unclaim: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH unclaim: 存在しない登録 → 404', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(unclaimChain({ existing: null }));
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH unclaim: fetch失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(unclaimChain({ fetchError: { message: 'DB error' } }));
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH unclaim: update失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(unclaimChain({ updateError: { message: 'DB error' } }));
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH unclaim: 成功 → 200 success:true・claim が null に戻る', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const chain = unclaimChain();
  mockAdminFrom.mockReturnValue(chain);
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  // 結果（呼び出し引数だけでなく実際に null で update されたこと）を主張する。
  expect(chain.update).toHaveBeenCalledWith({ claimed_by_user_id: null, claimed_at: null });
});

test('PATCH unclaim: 成功時に writeAuditLog が呼ばれる（旧値/新値つき）', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(unclaimChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    action: 'update',
    tableName: 'salons',
    recordId: SALON_UUID,
    oldValues: { claimed_by_user_id: '44444444-4444-4444-4444-444444444444', claimed_at: '2026-08-01T00:00:00Z' },
    newValues: { claimed_by_user_id: null, claimed_at: null },
  }));
});

test('PATCH unclaim: レートリミット → 429（action分岐より前に評価される）', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ action: 'unclaim' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: action が unclaim 以外の文字列でも通常の status 更新フローに落ちる', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ action: 'something-else', status: 'approved' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.status).toBe('approved');
});
