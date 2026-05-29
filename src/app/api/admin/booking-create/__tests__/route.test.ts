/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/booking-create（店頭/電話予約の登録）
 * 主な検証:
 *   - CSRF / RateLimit / 認可（非メンバー → 401, IDOR 防止）
 *   - email 任意・start>=end・メニュー/スタッフ施設所属・時間競合
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

// ダミー UUID（リテラルでの露出を避けるため動的生成 / zod v4 strict 用に有効な v4 形式）
const uuid = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const FACILITY_UUID = uuid('2');
const USER_ID = uuid('3');
const STAFF_UUID = uuid('4');
const MENU_UUID = uuid('5');

const mockGetUser = jest.fn();
const mockAuthFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser: mockGetUser }, from: mockAuthFrom })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

// チェーン可能かつ await 可能なモック（任意のメソッド列を許容し、最終的に result を解決）
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

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/booking-create');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return {
    customer_name: '山田 花子',
    booking_date: '2026-06-01',
    start_time: '10:00',
    end_time: '11:00',
    staff_id: STAFF_UUID,
    menu_id: MENU_UUID,
    ...overrides,
  };
}

// 認可成功（facility_members single が facility を返す）
function authMemberOk() {
  mockAuthFrom.mockReturnValue(chain({ data: { facility_id: FACILITY_UUID }, error: null }));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  authMemberOk();
});

test('CSRF 失敗 → 403', async () => {
  const { NextResponse } = await import('next/server');
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'x' }, { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('facility_id クエリ欠落 → 401', async () => {
  const res = await POST(makeRequest(validBody(), null));
  expect(res.status).toBe(401);
});

test('非メンバー（facility_members なし）→ 401', async () => {
  mockAuthFrom.mockReturnValue(chain({ data: null, error: null }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('バリデーション失敗（名前空）→ 400', async () => {
  const res = await POST(makeRequest(validBody({ customer_name: '' })));
  expect(res.status).toBe(400);
});

test('start>=end → 400', async () => {
  const res = await POST(makeRequest(validBody({ start_time: '11:00', end_time: '10:00' })));
  expect(res.status).toBe(400);
});

test('メニューが施設に存在しない → 400', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: null })); // facility_menus
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(400);
});

test('スタッフが施設に存在しない → 400', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 5000 } })) // menu
    .mockReturnValueOnce(chain({ data: null })); // staff not found
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(400);
});

test('時間競合 → 409', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 5000 } })) // menu
    .mockReturnValueOnce(chain({ data: { id: STAFF_UUID } })) // staff
    .mockReturnValueOnce(chain({ data: [{ id: 'x' }] })); // conflict
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(409);
});

test('insert エラー → 500', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 5000 } }))
    .mockReturnValueOnce(chain({ data: { id: STAFF_UUID } }))
    .mockReturnValueOnce(chain({ data: [] }))
    .mockReturnValueOnce(chain({ data: null, error: { message: 'fail' } })); // insert
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('正常登録（スタッフ+メニュー、price あり）→ 200', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: 5000 } }))
    .mockReturnValueOnce(chain({ data: { id: STAFF_UUID } }))
    .mockReturnValueOnce(chain({ data: [] }))
    .mockReturnValueOnce(chain({ data: { id: 'new-booking' }, error: null }));
  const res = await POST(makeRequest(validBody({ email: 'a@example.com', phone: '090-1111-2222', note: 'メモ', source: 'phone' })));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
  expect(json.id).toBe('new-booking');
});

test('正常登録（メニュー/スタッフなし・email空）→ 200', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: { id: 'new2' }, error: null })); // insert のみ
  const res = await POST(makeRequest(validBody({ staff_id: null, menu_id: null, email: '', phone: '' })));
  expect(res.status).toBe(200);
});

test('メニュー price null 分岐 → 200', async () => {
  mockAdminFrom
    .mockReturnValueOnce(chain({ data: { id: MENU_UUID, price: null } })) // price null
    .mockReturnValueOnce(chain({ data: { id: STAFF_UUID } }))
    .mockReturnValueOnce(chain({ data: [] }))
    .mockReturnValueOnce(chain({ data: { id: 'new3' }, error: null }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(200);
});

test('audit 用 getUser が null でも 200（userId null 分岐）', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: { id: 'new4' }, error: null })); // insert
  mockGetUser
    .mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) // 認可
    .mockResolvedValueOnce({ data: { user: null } }); // audit
  const res = await POST(makeRequest(validBody({ staff_id: null, menu_id: null })));
  expect(res.status).toBe(200);
});

test('不正JSON → 400（json catch 分岐）', async () => {
  const url = new URL('http://localhost/api/admin/booking-create');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json{',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('例外発生 → 500（catch）', async () => {
  (inMemoryRateLimit as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});
