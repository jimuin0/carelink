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

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
import { checkRateLimit } from '@/lib/rate-limit';

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

// 公開ガードの count クエリ（.select('id',{count,head}).eq(...) / staff は .eq().eq()）を
// thenable で表現。await すると { count, error } に解決する。select/eq は自身を返す。
function countChain(count: number | null, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  obj.then = (resolve: (v: { count: number | null; error: unknown }) => unknown) => resolve({ count, error });
  return obj;
}

// 公開ガードは facility_menus / facility_photos / staff_profiles を count し、その後
// facility_profiles を update する。テーブル名でディスパッチ（順序・消費数に非依存＝
// mockReturnValueOnce のキュー残留による次テストへの漏れを防ぐ）。
function publishMocks(opts: { menu?: number | null; photo?: number | null; staff?: number | null; countError?: unknown; updateError?: unknown } = {}) {
  // undefined は既定1(充足)、null は明示的にそのまま渡す（route の `?? 0` 分岐検証用）。
  const m = opts.menu === undefined ? 1 : opts.menu;
  const p = opts.photo === undefined ? 1 : opts.photo;
  const s = opts.staff === undefined ? 1 : opts.staff;
  const e = opts.countError ?? null;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_menus') return countChain(m, e);
    if (table === 'facility_photos') return countChain(p, e);
    if (table === 'staff_profiles') return countChain(s, e);
    return updateChain(opts.updateError ?? null); // facility_profiles
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
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
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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

test('PATCH: ?action=status published（必須項目充足）→ 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: published でメニュー0件 → 400（公開ガード）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: null, photo: 1, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toContain('メニューを1つ以上登録してください');
});

test('PATCH: published で写真0件 → 400（公開ガード）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: null, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toContain('写真を1枚以上登録してください');
});

test('PATCH: published でスタッフ0件（count=null）→ 400（公開ガード）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: null });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toContain('スタッフを1人以上登録してください');
});

test('PATCH: published で count 取得エラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ countError: { message: 'count fail' } });
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makePatchRequest({ name: '施設名' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
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

test('PATCH: board_slot_minutes が許可外(45) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '施設', board_slot_minutes: 45 }));
  expect(res.status).toBe(400);
});

test('PATCH: board_slot_minutes が許可値(30) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', board_slot_minutes: 30 }));
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

test('PATCH: business_hours の未知キー（曜日以外）は strip されDB更新に乗らない', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const updateFn = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockAdminFrom.mockReturnValue({ update: updateFn });
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '09:00', close: '18:00' }, evil: { open: '00:00', close: '23:59' }, foo: { open: '01:00', close: '02:00' } },
  }));
  expect(res.status).toBe(200);
  const payload = updateFn.mock.calls[0][0];
  expect(payload.business_hours).toEqual({ mon: { open: '09:00', close: '18:00' } });
  expect(payload.business_hours.evil).toBeUndefined();
  expect(payload.business_hours.foo).toBeUndefined();
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
