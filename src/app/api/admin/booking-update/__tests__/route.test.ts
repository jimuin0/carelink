/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/booking-update（予約の内容変更）
 * 主な検証:
 *   - CSRF / RateLimit / 認可（非メンバー → 404, IDOR 防止）
 *   - 部分更新・時間整合・メニュー/スタッフ施設所属・時間競合
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

// ダミー UUID（リテラル露出回避 / zod v4 strict 用に有効な v4 形式）
const uuid = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const FACILITY_UUID = uuid('2');
const USER_ID = uuid('3');
const STAFF_UUID = uuid('4');
const MENU_UUID = uuid('5');
const BOOKING_UUID = uuid('1');

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();
const mockAdminRpc = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function chain(result: unknown) {
  const p = Promise.resolve(result);
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/booking-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BOOKING = {
  id: BOOKING_UUID,
  facility_id: FACILITY_UUID,
  staff_id: STAFF_UUID,
  menu_id: MENU_UUID,
  booking_date: '2026-06-01',
  start_time: '10:00:00',
  end_time: '11:00:00',
  customer_name: '既存太郎',
  email: 'existing@example.com',
  phone: '090-0000-0000',
  note: null,
  total_price: 5000,
};

// よくある成功系の admin.from 呼び出し列を組み立てるヘルパ
function queueBookingAndMember(booking: unknown = BOOKING, member: unknown = { facility_id: FACILITY_UUID }) {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: booking })) // bookings select
    .mockReturnValueOnce(chain({ data: member })); // facility_members
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

test('CSRF 失敗 → 403', async () => {
  const { NextResponse } = await import('next/server');
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'x' }, { status: 403 }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(401);
});

test('バリデーション失敗（booking_id なし）→ 400', async () => {
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('予約が存在しない → 404', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: null })); // bookings select → null
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(404);
});

test('非メンバー → 404', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: BOOKING }))
    .mockReturnValueOnce(chain({ data: null })); // membership null
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(404);
});

test('start>=end → 400', async () => {
  queueBookingAndMember();
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, start_time: '12:00', end_time: '11:00' }));
  expect(res.status).toBe(400);
});

test('メニューが施設に存在しない → 400', async () => {
  queueBookingAndMember();
  mockAdminFrom.mockReturnValueOnce(chain({ data: null })); // menu lookup
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, menu_id: MENU_UUID }));
  expect(res.status).toBe(400);
});

test('スタッフが施設に存在しない → 400', async () => {
  queueBookingAndMember();
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 5000 } })) // menu ok
    .mockReturnValueOnce(chain({ data: null })); // staff lookup null
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, menu_id: MENU_UUID, staff_id: STAFF_UUID }));
  expect(res.status).toBe(400);
});

test('時間競合 → 409（RPC が BOOKING_CONFLICT を返す）', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: null, error: { message: 'BOOKING_CONFLICT: この時間帯は既に予約が入っています' } }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, start_time: '10:30', end_time: '11:30' }));
  expect(res.status).toBe(409);
});

test('RPC エラー（非競合）→ 500', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: null, error: { message: 'fail' } }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, start_time: '10:30', end_time: '11:30' }));
  expect(res.status).toBe(500);
});

test('RPC が NULL（対象なし）→ 404', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: null, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, start_time: '10:30', end_time: '11:30' }));
  expect(res.status).toBe(404);
});

test('正常更新（全フィールド、menu/staff あり）→ 200', async () => {
  queueBookingAndMember();
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 7000 } })) // menu
    .mockReturnValueOnce(chain({ data: { id: STAFF_UUID } })); // staff
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({
    booking_id: BOOKING_UUID,
    staff_id: STAFF_UUID,
    menu_id: MENU_UUID,
    booking_date: '2026-06-02',
    start_time: '13:00',
    end_time: '14:00',
    customer_name: '更新太郎',
    email: 'b@example.com',
    phone: '090-9999-8888',
    note: '更新メモ',
  }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
});

test('正常更新（最小: booking_id のみ。既存値維持）→ 200', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

test('正常更新（staff_id=null、email/phone 空→null）→ 200', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, staff_id: null, email: '', phone: '' }));
  expect(res.status).toBe(200);
});

test('正常更新（menu_id=null → メニュー検証スキップ）→ 200', async () => {
  queueBookingAndMember();
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, menu_id: null }));
  expect(res.status).toBe(200);
});

test('正常更新（メニュー price null → total_price null）→ 200', async () => {
  queueBookingAndMember();
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: null } })); // menu price null
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID, menu_id: MENU_UUID }));
  expect(res.status).toBe(200);
});

test('既存 total_price が null の予約更新 → 200（total_price ?? null 分岐）', async () => {
  queueBookingAndMember({ ...BOOKING, total_price: null });
  mockAdminRpc.mockReturnValueOnce(chain({ data: BOOKING_UUID, error: null }));
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

test('不正JSON → 400（json catch 分岐）', async () => {
  const req = new NextRequest('http://localhost/api/admin/booking-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json{',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('例外発生 → 500（catch）', async () => {
  (inMemoryRateLimit as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
  const res = await POST(makeRequest({ booking_id: BOOKING_UUID }));
  expect(res.status).toBe(500);
});
