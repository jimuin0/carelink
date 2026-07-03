/**
 * @jest-environment node
 *
 * Tests for PUT/POST/DELETE /api/admin/staff/[id]/schedule
 * Key assertions:
 *   - UUID_REGEX for [id]
 *   - Non-member → 401 / Staff not in facility → 401
 *   - PUT/POST: time validation
 *   - DELETE: override_id must be RFC 4122 UUID
 *   - G7 ガード: 既存予約に影響がある変更は force なしで 409(BOOKINGS_AFFECTED)、force で実行
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const STAFF_UUID    = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';
const OVERRIDE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // RFC 4122
const MONDAY = '2099-01-05'; // 未来の月曜(DOW=1)
const TUESDAY = '2099-01-06'; // 未来の火曜(DOW=2)

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PUT, POST, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeProps(id = STAFF_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string, body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Anon client: facility_members membership check (ends with .single())
function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// 汎用: await でも .single()/.maybeSingle() でも result を返し、insert/upsert/delete も設定可能なチェーン。
type Res = { data?: unknown; error?: unknown };
function chain(readResult: Res = { data: null, error: null }, terminals: { insert?: Res; upsert?: Res; delete?: Res } = {}) {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'not', 'update']) {
    self[m] = jest.fn(() => self);
  }
  self.single = jest.fn(() => Promise.resolve(readResult));
  self.maybeSingle = jest.fn(() => Promise.resolve(readResult));
  self.then = (res: (v: Res) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(readResult).then(res, rej);
  self.insert = jest.fn(() => Promise.resolve(terminals.insert ?? { error: null }));
  self.upsert = jest.fn(() => Promise.resolve(terminals.upsert ?? { error: null }));
  self.delete = jest.fn(() => {
    const d: Record<string, unknown> = {};
    d.eq = jest.fn(() => d);
    d.then = (res: (v: Res) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(terminals.delete ?? { error: null }).then(res, rej);
    return d;
  });
  return self;
}

type AdminCfg = {
  staff?: unknown;                 // staff_profiles.single result data
  bookings?: unknown[];            // bookings guard read
  overrides?: unknown[];           // schedule_overrides guard read (PUT)
  schedDeleteErr?: unknown;        // staff_schedules delete error (PUT)
  insertErr?: unknown;             // staff_schedules insert error (PUT)
  upsertErr?: unknown;             // schedule_overrides upsert error (POST)
  overrideDeleteErr?: unknown;     // schedule_overrides delete error (DELETE)
  upsertSpy?: (row: unknown) => void;
};

function setupAdmin(cfg: AdminCfg = {}) {
  const {
    staff = { id: STAFF_UUID }, bookings = [], overrides = [],
    schedDeleteErr = null, insertErr = null, upsertErr = null, overrideDeleteErr = null, upsertSpy,
  } = cfg;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') return chain({ data: staff, error: null });
    if (table === 'bookings') return chain({ data: bookings, error: null });
    if (table === 'staff_schedules') return chain({ data: null, error: null }, { delete: { error: schedDeleteErr }, insert: { error: insertErr } });
    if (table === 'schedule_overrides') {
      const c = chain({ data: overrides, error: null }, { upsert: { error: upsertErr }, delete: { error: overrideDeleteErr } });
      if (upsertSpy) c.upsert = jest.fn((row: unknown) => { upsertSpy(row); return Promise.resolve({ error: upsertErr }); });
      return c;
    }
    return chain();
  });
}

const VALID_SCHEDULE = { schedules: [{ day_of_week: 1, start_time: '09:00', end_time: '18:00' }] };

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  setupAdmin();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── auth / verify ────────────────────────────────────────────────────────────

test('PUT: 未認証ユーザー → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: facility_id なし → 401', async () => {
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE, null), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: 不正な facility_id UUID → 401', async () => {
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE, 'not-a-uuid'), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: スタッフが施設に所属しない → 401', async () => {
  setupAdmin({ staff: null });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

test('PUT: 不正UUID → 400', async () => {
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PUT: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(429);
});

test('PUT: end_time が start_time 以前 → 400', async () => {
  const res = await PUT(makeRequest('PUT', {
    schedules: [{ day_of_week: 1, start_time: '18:00', end_time: '09:00' }],
  }), makeProps());
  expect(res.status).toBe(400);
});

test('PUT: 正常更新（スケジュールあり・影響予約なし）→ 200', async () => {
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PUT: delete DBエラー → 500', async () => {
  setupAdmin({ schedDeleteErr: { message: 'delete failed' } });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(500);
});

test('PUT: insert DBエラー → 500', async () => {
  setupAdmin({ insertErr: { message: 'insert failed' } });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(500);
});

test('PUT: 正常更新（空スケジュール）→ 200', async () => {
  const res = await PUT(makeRequest('PUT', { schedules: [] }), makeProps());
  expect(res.status).toBe(200);
});

// ─── PUT: G7 ガード ──────────────────────────────────────────────────────────

test('PUT: 曜日削除で不在になる予約あり → 409 BOOKINGS_AFFECTED', async () => {
  // 火曜の予約があるが新スケジュールは月曜のみ → 火曜が休みになり不在
  setupAdmin({ bookings: [{ booking_date: TUESDAY, start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  const json = await res.json();
  expect(res.status).toBe(409);
  expect(json.code).toBe('BOOKINGS_AFFECTED');
  expect(json.affectedBookings).toBe(1);
});

test('PUT: 勤務時間外へはみ出す予約あり → 409', async () => {
  // 月曜だが 08:00 開始で新勤務(09:00-18:00)の外
  setupAdmin({ bookings: [{ booking_date: MONDAY, start_time: '08:00:00', end_time: '09:30:00' }] });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(409);
});

test('PUT: 新勤務時間内に収まる予約 → 影響なし 200', async () => {
  setupAdmin({ bookings: [{ booking_date: MONDAY, start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(200);
});

test('PUT: 影響予約が override 日にある → 対象外(200)', async () => {
  // 火曜の予約だが、その日は override 設定済み → 週間変更の対象外
  setupAdmin({
    bookings: [{ booking_date: TUESDAY, start_time: '10:00:00', end_time: '11:00:00' }],
    overrides: [{ date: TUESDAY }],
  });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(200);
});

test('PUT: 影響予約あり + force:true → 実行(200)', async () => {
  setupAdmin({ bookings: [{ booking_date: TUESDAY, start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await PUT(makeRequest('PUT', { ...VALID_SCHEDULE, force: true }), makeProps());
  expect(res.status).toBe(200);
});

test('PUT: bookings/overrides クエリが null → ?? [] で 0件扱い 200', async () => {
  setupAdmin({ bookings: null as unknown as unknown[], overrides: null as unknown as unknown[] });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(200);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 不正UUID → 400', async () => {
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: false }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: date 不正形式 → 400', async () => {
  const res = await POST(makeRequest('POST', { date: '2026/01/15', is_holiday: false }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: 終了時間が開始時間より前 → 400', async () => {
  const res = await POST(makeRequest('POST', {
    date: MONDAY, is_holiday: false, start_time: '18:00', end_time: '09:00',
  }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: 正常作成（休日・影響予約なし）→ 201', async () => {
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: 正常作成（勤務・影響予約なし）→ 201', async () => {
  const res = await POST(makeRequest('POST', {
    date: MONDAY, is_holiday: false, start_time: '09:00', end_time: '18:00',
  }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: upsert DBエラー → 500', async () => {
  setupAdmin({ upsertErr: { message: 'upsert failed' } });
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(500);
});

test('POST: is_holiday=true → times not included in row', async () => {
  let upsertArgs: unknown;
  setupAdmin({ upsertSpy: (row) => { upsertArgs = row; } });
  await POST(makeRequest('POST', { date: MONDAY, is_holiday: true, start_time: '09:00', end_time: '18:00' }), makeProps());
  expect((upsertArgs as { start_time?: unknown }).start_time).toBeUndefined();
  expect((upsertArgs as { end_time?: unknown }).end_time).toBeUndefined();
});

test('POST: is_holiday=false で start/end 未指定でも upsert される', async () => {
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: false }), makeProps());
  expect(res.status).toBe(201);
});

// ─── POST: G7 ガード ─────────────────────────────────────────────────────────

test('POST: 休日化でその日の予約あり → 409 BOOKINGS_AFFECTED', async () => {
  setupAdmin({ bookings: [{ start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(409);
  expect(json.code).toBe('BOOKINGS_AFFECTED');
  expect(json.affectedBookings).toBe(1);
});

test('POST: 休日化 + force:true → 実行(201)', async () => {
  setupAdmin({ bookings: [{ start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true, force: true }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: 時間変更で新時間外の予約あり → 409', async () => {
  setupAdmin({ bookings: [{ start_time: '08:00:00', end_time: '09:00:00' }] });
  const res = await POST(makeRequest('POST', {
    date: MONDAY, is_holiday: false, start_time: '09:00', end_time: '18:00',
  }), makeProps());
  expect(res.status).toBe(409);
});

test('POST: 時間変更でも新時間内の予約は影響なし → 201', async () => {
  setupAdmin({ bookings: [{ start_time: '10:00:00', end_time: '11:00:00' }] });
  const res = await POST(makeRequest('POST', {
    date: MONDAY, is_holiday: false, start_time: '09:00', end_time: '18:00',
  }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: bookings クエリが null → ?? [] で 0件扱い 201', async () => {
  setupAdmin({ bookings: null as unknown as unknown[] });
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(201);
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: override_id が非RFC4122UUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE', { override_id: 'bad-uuid' }), makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: DB失敗 → 500', async () => {
  setupAdmin({ overrideDeleteErr: { message: 'DB error' } });
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 正常削除 → 200', async () => {
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

// ─── CSRF / rate limit / JSON / その他分岐 ────────────────────────────────────

test('PUT: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res).toBe(csrfRes);
});

test('POST: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res).toBe(csrfRes);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 不正な params.id UUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PUT: 不正な JSON body → 400', async () => {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  const res = await PUT(req, makeProps());
  expect(res.status).toBe(400);
});

test('POST: 不正な JSON body → 400', async () => {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  const res = await POST(req, makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: 不正な JSON body → 400', async () => {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  const res = await DELETE(req, makeProps());
  expect(res.status).toBe(400);
});

test('POST: 非管理者 (memberSingle null) → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: スタッフが施設に所属しない → 401', async () => {
  setupAdmin({ staff: null });
  const res = await POST(makeRequest('POST', { date: MONDAY, is_holiday: true }), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 非管理者 (memberSingle null) → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: スタッフが施設に所属しない → 401', async () => {
  setupAdmin({ staff: null });
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: x-forwarded-for ヘッダから IP 取得', async () => {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify(VALID_SCHEDULE),
  });
  const res = await PUT(req, makeProps());
  expect(res.status).toBe(200);
});
