/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/settings
 * Key assertions:
 *   - Non-admin → 401 (IDOR prevention)
 *   - Business hours: close <= open → 400
 *   - ?action=status: published/suspended/draft transitions
 *   - DB update failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

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

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const VALID_BODY = { name: 'テスト施設' };

function makePatchRequest(body: object = VALID_BODY, params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/settings');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

// status='published' 公開ゲート用 dispatch mock。
// facility_profiles: select→eq→single（住所チェック＋revalidateのslug解決）と update→eq の両方を提供。
// facility_menus: select(count,head)→eq でメニュー件数を返す。
function publishMock({
  prof = { prefecture: '東京都', city: '渋谷区', address: '1-1-1' },
  menuCount = 1,
  updateError = null,
  profError = null,
  menuError = null,
}: {
  prof?: { prefecture: string | null; city: string | null; address: string | null } | null;
  menuCount?: number | null;
  updateError?: unknown;
  profError?: unknown;
  menuError?: unknown;
} = {}) {
  return jest.fn((table: string) => {
    if (table === 'facility_menus') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ count: menuCount, error: menuError })),
        }),
      };
    }
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: profError ? null : prof, error: profError })),
        })),
      })),
      update: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: updateError })),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makePatchRequest(VALID_BODY, {}));
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(429);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('PATCH: name 空文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '' }));
  expect(res.status).toBe(400);
});

test('PATCH: business_hours で close <= open → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '18:00', close: '09:00' } },
  }));
  expect(res.status).toBe(400);
});

test('PATCH: booking_buffer_minutes > 120 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', booking_buffer_minutes: 121 }));
  expect(res.status).toBe(400);
});

// ─── Status action ────────────────────────────────────────────────────────────

test('PATCH: ?action=status published（住所あり・メニュー1件）→ 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock());
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: 公開ゲート 住所欠落 → 400（missing に住所系）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ prof: { prefecture: '', city: null, address: '   ' } }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toEqual(expect.arrayContaining(['都道府県', '市区町村', '住所']));
});

test('PATCH: 公開ゲート メニュー0件 → 400（missing にメニュー）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ menuCount: 0 }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toEqual(expect.arrayContaining(['メニュー（1件以上）']));
});

test('PATCH: 公開ゲート メニュー件数 null → 400（メニュー扱い）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ menuCount: null }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(400);
});

test('PATCH: 公開ゲート プロフィール取得失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ profError: { message: 'db' } }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

test('PATCH: 公開ゲート メニュー件数取得失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ menuError: { message: 'db' } }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

test('PATCH: 公開ゲート通過後の update 失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation(publishMock({ updateError: { message: 'db' } }));
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

test('PATCH: ?action=status 無効なステータス → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ status: 'deleted' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(400);
});

test('PATCH: ?action=status DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('PATCH: 正常更新 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '更新施設', booking_auto_confirm: true }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ name: 'test' }));
  expect(res.status).toBe(500);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(403);
});

test('PATCH: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makePatchRequest({ name: '施設名' }));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await PATCH(makePatchRequest({ name: '施設名' }));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('PATCH: ?action=status suspended → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: ?action=status draft → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'draft' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: website_url が有効URL → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: 'https://example.com' }));
  expect(res.status).toBe(200);
});

test('PATCH: booking_buffer_minutes が 120 (上限ぴったり) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', booking_buffer_minutes: 120 }));
  expect(res.status).toBe(200);
});

test('PATCH: business_hours の hours が null → ループスキップして 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { sun: null, mon: { open: '09:00', close: '18:00' } },
  }));
  expect(res.status).toBe(200);
});

test('PATCH: business_hours が valid (close > open) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '09:00', close: '18:00' } },
  }));
  expect(res.status).toBe(200);
});

test('PATCH: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/settings');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req);
  expect(res.status).toBe(400);
});

test('PATCH: facility_id が不正UUID → 401', async () => {
  const res = await PATCH(makePatchRequest(VALID_BODY, { facility_id: 'bad-uuid' }));
  expect(res.status).toBe(401);
});

// ─── 拡張カラム不在フォールバック（#16） ──────────────────────────────────────
test('PATCH: 拡張カラム不在(PGRST204)→除外して再試行し 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom
    .mockReturnValueOnce(updateChain({ code: 'PGRST204', message: 'column does not exist' }))
    .mockReturnValueOnce(updateChain());
  const res = await PATCH(makePatchRequest({ name: 'テスト施設', owner_message: 'こんにちは' }));
  expect(res.status).toBe(200);
});
