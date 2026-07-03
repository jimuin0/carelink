/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/bookings (管理者がサロンボードから手動作成)
 * Key assertions:
 *   - CSRF / RateLimit / 認証(owner|admin) / Zod / 時間整合
 *   - メニュー越境(IDOR)防止 / スタッフ越境防止 / 指名料加算
 *   - create_booking_atomic の conflict(409)/error(500)/null(500)
 *   - email 任意・ある場合のみ確認メール送信 / status=confirmed・user_id=null
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: {} }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendBookingConfirmed: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const MENU_UUID = '44444444-4444-4444-8444-444444444444';
const STAFF_UUID = '55555555-5555-4555-8555-555555555555';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmed } from '@/lib/email';

function makeRequest(body: object) {
  return new Request('http://localhost/api/admin/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return {
    facility_id: FACILITY_UUID,
    menu_ids: [MENU_UUID],
    booking_date: '2026-07-01',
    start_time: '10:00',
    end_time: '11:00',
    customer_name: 'テスト太郎',
    ...overrides,
  };
}

// facility_members 所属チェック（anon）
function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}
// facility_menus（.select().in().eq() を await）
function menusChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    eq: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}
// staff_profiles（.select().eq().eq().maybeSingle()）
function staffChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}
// facility_profiles（.select().eq().single()）
function facilityChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function setupAdminTables(opts: {
  menus?: unknown;
  staff?: unknown;
  facility?: unknown;
  bookingsUpdateError?: unknown;
} = {}) {
  const menus = opts.menus ?? [{ id: MENU_UUID, name: 'カット', price: 5000 }];
  const facility = opts.facility ?? { name: 'テストサロン' };
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_menus') return menusChain(menus);
    if (table === 'staff_profiles') return staffChain(opts.staff ?? null);
    if (table === 'facility_profiles') return facilityChain(facility);
    // 複数メニュー時の menu_ids 永続化 update().eq()。
    if (table === 'bookings') return { update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: opts.bookingsUpdateError ?? null })) })) };
    return {};
  });
}

const MENU_UUID2 = '44444444-4444-4444-8444-444444444445';

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue({ data: 'booking-1', error: null });
  setupAdminTables();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('CSRFエラー → 返却', async () => {
  const csrf = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrf);
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(429);
});

test('不正なJSON → 400', async () => {
  const req = new Request('http://localhost/api/admin/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req as never);
  expect(res.status).toBe(400);
});

test('スキーマ不正（customer_name 空） → 400', async () => {
  const res = await POST(makeRequest(validBody({ customer_name: '' })) as never);
  expect(res.status).toBe(400);
});

test('開始 >= 終了 → 400', async () => {
  const res = await POST(makeRequest(validBody({ start_time: '11:00', end_time: '10:00' })) as never);
  expect(res.status).toBe(400);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(401);
});

test('非メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(401);
});

test('メニューが他施設（未検出） → 400', async () => {
  setupAdminTables({ menus: [] });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(400);
});

test('スタッフ指定が他施設（未検出） → 400', async () => {
  setupAdminTables({ staff: null });
  const res = await POST(makeRequest(validBody({ staff_id: STAFF_UUID })) as never);
  expect(res.status).toBe(400);
});

test('複数メニュー → menu_ids を保存 → 201', async () => {
  setupAdminTables({ menus: [{ id: MENU_UUID, name: 'カット', price: 5000 }, { id: MENU_UUID2, name: 'カラー', price: 3000 }] });
  const res = await POST(makeRequest(validBody({ menu_ids: [MENU_UUID, MENU_UUID2] })) as never);
  expect(res.status).toBe(201);
});

test('複数メニューで menu_ids 保存が失敗 → warn のみ・201', async () => {
  setupAdminTables({
    menus: [{ id: MENU_UUID, name: 'カット', price: 5000 }, { id: MENU_UUID2, name: 'カラー', price: 3000 }],
    bookingsUpdateError: { message: 'persist fail' },
  });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = await POST(makeRequest(validBody({ menu_ids: [MENU_UUID, MENU_UUID2] })) as never);
  expect(res.status).toBe(201);
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
});

test('スタッフ指定（指名料あり） → 201・指名料加算', async () => {
  setupAdminTables({ staff: { name: '佐藤', nomination_fee: 1000 } });
  const res = await POST(makeRequest(validBody({ staff_id: STAFF_UUID })) as never);
  expect(res.status).toBe(201);
  // total_price = 5000 + 1000
  expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_total_price: 6000, p_status: 'confirmed', p_user_id: null }));
});

test('スタッフ指定（指名料なし null） → 201', async () => {
  setupAdminTables({ staff: { name: '佐藤', nomination_fee: null } });
  const res = await POST(makeRequest(validBody({ staff_id: STAFF_UUID })) as never);
  expect(res.status).toBe(201);
  expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_total_price: 5000 }));
});

test('予約競合 → 409', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'BOOKING_CONFLICT' } });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(409);
});

test('RPCエラー（その他） → 500', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(500);
});

test('RPCが null id → 500', async () => {
  mockRpc.mockResolvedValue({ data: '', error: null });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(500);
});

test('正常作成（email なし） → 201・メール送信なし', async () => {
  const res = await POST(makeRequest(validBody()) as never);
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.success).toBe(true);
  expect(json.id).toBe('booking-1');
  expect(sendBookingConfirmed).not.toHaveBeenCalled();
});

test('正常作成（email あり） → 201・確認メール送信', async () => {
  const res = await POST(makeRequest(validBody({ email: 'taro@example.com' })) as never);
  expect(res.status).toBe(201);
  expect(sendBookingConfirmed).toHaveBeenCalledWith(expect.objectContaining({
    customerEmail: 'taro@example.com',
    facilityName: 'テストサロン',
    menuName: 'カット',
  }));
});

test('メニュー price が null → 201（price フォールバック0）', async () => {
  setupAdminTables({ menus: [{ id: MENU_UUID, name: 'カット', price: null }] });
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(201);
  expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_total_price: 0 }));
});

test('facility_menus が null → 400（menuList フォールバック分岐）', async () => {
  mockAdminFrom.mockImplementation((t: string) => (t === 'facility_menus' ? menusChain(null) : staffChain(null)));
  const res = await POST(makeRequest(validBody()) as never);
  expect(res.status).toBe(400);
});

test('スタッフ name が null → 201（staffName undefined 分岐）', async () => {
  setupAdminTables({ staff: { name: null, nomination_fee: 0 } });
  const res = await POST(makeRequest(validBody({ staff_id: STAFF_UUID })) as never);
  expect(res.status).toBe(201);
});

test('email あり・facility_profiles が null → 201（facilityName 空）', async () => {
  mockAdminFrom.mockImplementation((t: string) => {
    if (t === 'facility_menus') return menusChain([{ id: MENU_UUID, name: 'カット', price: 5000 }]);
    if (t === 'facility_profiles') return facilityChain(null);
    return staffChain(null);
  });
  const res = await POST(makeRequest(validBody({ email: 'taro@example.com' })) as never);
  expect(res.status).toBe(201);
  expect(sendBookingConfirmed).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '' }));
});

test('確認メール送信失敗（sendBookingConfirmed が false）→ 201のまま（fire-and-forget・可視化のみ）', async () => {
  (sendBookingConfirmed as jest.Mock).mockResolvedValueOnce(false);
  const res = await POST(makeRequest(validBody({ email: 'taro@example.com' })) as never);
  expect(res.status).toBe(201);
  await Promise.resolve();
  expect(sendBookingConfirmed).toHaveBeenCalled();
});
