/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/job-applications/[id]
 * Key assertions:
 *   - Both "not found" and "wrong owner" → 404 (ID enumeration prevention)
 *   - Invalid status → 400
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const APP_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
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

function makeRequest(body: object = { status: 'reviewing' }) {
  return new Request(`http://localhost/api/admin/job-applications/${APP_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = APP_UUID) {
  return { params: Promise.resolve({ id }) };
}

function existingChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function membershipChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data, error })),
            maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
      }),
    }),
  };
}

function setupOwnership() {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'owner' });
    return updateChain({ id: APP_UUID, status: 'reviewing' });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 応募が存在しない → 404 (ID列挙防止)', async () => {
  mockAdminFrom.mockReturnValue(existingChain(null)); // not found
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 他施設の応募 → 404 (ID列挙防止)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: 'other-facility', status: 'pending' });
    return membershipChain(null); // not a member of that facility
  });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 不正なstatus → 400', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest({ status: 'ghosted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return updateChain(null, { message: 'DB error' });
  });
  const res = await PATCH(makeRequest({ status: 'reviewing' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 更新0行（verify後にTOCTOUで他施設化/削除）→ 404', async () => {
  // .maybeSingle() が error なし・data null（0行）を返すケース。ownership 確認後に facility_id
  // が変わる/削除される TOCTOU 等で発生。defence-in-depth の facility_id CAS ガードが機能した
  // 場合の 404 分岐（menus/[id] 等の同型ルートと同一パターン）の回帰防止。
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return updateChain(null, null);
  });
  const res = await PATCH(makeRequest({ status: 'reviewing' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 正常更新 → 200 with application', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest({ status: 'interview_scheduled', notes: 'meeting at 14:00' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.application).toBeDefined();
});

test('PATCH: status=hired → 200', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'offer_made' });
    if (callNum === 2) return membershipChain({ role: 'owner' });
    return updateChain({ id: APP_UUID, status: 'hired' });
  });
  const res = await PATCH(makeRequest({ status: 'hired' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: status=withdrawn → 200', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return updateChain({ id: APP_UUID, status: 'withdrawn' });
  });
  const res = await PATCH(makeRequest({ status: 'withdrawn' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット params (20/60s)', async () => {
  setupOwnership();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makeRequest({ status: 'reviewing' }), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('PATCH: レスポンスが { application: ... } 形式', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest({ status: 'reviewing' }), makeProps());
  const json = await res.json();
  expect(json.application).toBeDefined();
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('PATCH: referral_fee_yen が数値 → Math.max(0, ...) で保存', async () => {
  let callNum = 0;
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return {
      update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
              maybeSingle: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
            }),
          }),
        }),
      };}),
    };
  });
  await PATCH(makeRequest({ referral_fee_yen: -100 }), makeProps());
  expect(captured?.referral_fee_yen).toBe(0);
});

test('PATCH: referral_fee_yen が非数値 → null で保存', async () => {
  let callNum = 0;
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return {
      update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
              maybeSingle: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
            }),
          }),
        }),
      };}),
    };
  });
  await PATCH(makeRequest({ referral_fee_yen: 'not-a-number' }), makeProps());
  expect(captured?.referral_fee_yen).toBeNull();
});

test('PATCH: notes が非文字列 → null で保存', async () => {
  let callNum = 0;
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return {
      update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
              maybeSingle: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
            }),
          }),
        }),
      };}),
    };
  });
  await PATCH(makeRequest({ notes: 12345 }), makeProps());
  expect(captured?.notes).toBeNull();
});

test('PATCH: status=hired が既に hired → hired_at は更新しない', async () => {
  let callNum = 0;
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'hired' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return {
      update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
              maybeSingle: jest.fn(() => Promise.resolve({ data: { id: APP_UUID }, error: null })),
            }),
          }),
        }),
      };}),
    };
  });
  await PATCH(makeRequest({ status: 'hired' }), makeProps());
  expect(captured?.hired_at).toBeUndefined();
});

test('PATCH: 不正な JSON body でも 200 (空オブジェクト扱い)', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/job-applications/${APP_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/job-applications/${APP_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify({ status: 'reviewing' }),
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(200);
});
