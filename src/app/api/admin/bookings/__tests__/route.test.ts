/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: {} }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendBookingConfirmed: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
const FACILITY = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const MENU = '44444444-4444-4444-8444-444444444444';
const STAFF = '55555555-5555-4555-8555-555555555555';
const OP = '66666666-6666-4666-8666-666666666666';
const BOOKING = '77777777-7777-4777-8777-777777777777';
const mockGetUser = jest.fn(), mockFrom = jest.fn(), mockRpc = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
import { POST, GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmed } from '@/lib/email';
import { writeAuditLog } from '@/lib/audit-logger';

function body(overrides: object = {}) {
  return { operation_id: OP, facility_id: FACILITY, menu_ids: [MENU], booking_date: '2026-07-01',
    start_time: '10:00', end_time: '11:00', customer_name: 'テスト予約', ...overrides };
}
function request(value: object) {
  return new Request('http://localhost/api/admin/bookings', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}
const saved = { booking_id: BOOKING, replayed: false, total_price: 6000,
  menu_names: 'カット、カラー', staff_name: '担当', facility_name: 'テスト店舗' };
function member(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data, error }) };
}
beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (sendBookingConfirmed as jest.Mock).mockResolvedValue(true);
  mockGetUser.mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
  mockFrom.mockReturnValue(member({ facility_id: FACILITY }));
  mockRpc.mockResolvedValue({ data: saved, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';
});
test('CSRF／レート制限はRPCより前に拒否', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('csrf', { status: 403 }));
  expect((await POST(request(body()) as never)).status).toBe(403);
  (checkRateLimit as jest.Mock).mockReturnValueOnce(true);
  expect((await POST(request(body()) as never)).status).toBe(429);
  expect(mockRpc).not.toHaveBeenCalled();
});
test('壊れたJSONは400', async () => {
  expect((await POST(new Request('http://localhost/api/admin/bookings', { method: 'POST', body: '{' }) as never)).status).toBe(400);
});
test.each([
  { operation_id: undefined }, { customer_name: ' ' }, { menu_ids: [MENU, MENU] }, { menu_ids: [] },
  { booking_date: '2026-02-30' }, { start_time: '11:00', end_time: '10:00' },
  { email: 'not-email' }, { note: 'x'.repeat(501) }, { staff_id: 'bad' },
])('入力境界を拒否し保存しない：%j', async override => {
  expect((await POST(request(body(override)) as never)).status).toBe(400);
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null, { id: ACTOR }])('未認証／認証障害は401', async user => {
  mockGetUser.mockResolvedValue({ data: { user }, error: user ? { message: 'auth failed' } : null });
  expect((await POST(request(body()) as never)).status).toBe(401);
});
test('非管理者は401、所属確認障害は500で正常や非所属に変換しない', async () => {
  mockFrom.mockReturnValueOnce(member(null));
  expect((await POST(request(body()) as never)).status).toBe(401);
  mockFrom.mockReturnValueOnce(member(null, { message: 'DB unavailable' }));
  expect((await POST(request(body()) as never)).status).toBe(500);
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([
  ['MANUAL_FORBIDDEN', '42501', 403],
  ['BOOKING_CONFLICT', '', 409],
  ['MANUAL_OPERATION_CONFLICT', '', 409],
  ['MANUAL_OPERATION_RETIRED', '', 409],
  ['MANUAL_MENU_UNAVAILABLE', '', 400],
  ['MANUAL_STAFF_UNAVAILABLE', '', 400],
  ['MANUAL_PRICE_INVALID', '', 400],
  ['unexpected DB failure', '', 500],
])('原子的RPCエラー %s は %s/%s。成功応答しない', async (message, code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { message, code } });
  const res = await POST(request(body()) as never);
  expect(res.status).toBe(status);
  expect((await res.json()).success).not.toBe(true);
  expect(sendBookingConfirmed).not.toHaveBeenCalled();
});
test.each([null, '', { ...saved, booking_id: 'bad' }, { ...saved, replayed: undefined }])('結果不明を成功に変換しない：%j', async data => {
  mockRpc.mockResolvedValue({ data, error: null });
  expect((await POST(request(body()) as never)).status).toBe(500);
});
test('全メニューと原操作IDを一つのRPCへ渡す。価格はブラウザから信用しない', async () => {
  const second = '44444444-4444-4444-8444-444444444445';
  const res = await POST(request(body({ menu_ids: [MENU, second], staff_id: STAFF, customer_name: '  テスト予約  ', total_price: 1 })) as never);
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ success: true, id: BOOKING, replayed: false, notification: 'not_requested' });
  expect(mockRpc).toHaveBeenCalledWith('create_manual_booking_atomic', {
    p_actor_id: ACTOR, p_operation_id: OP, p_input: { facility_id: FACILITY, staff_id: STAFF,
      menu_ids: [MENU, second], booking_date: '2026-07-01', start_time: '10:00', end_time: '11:00',
      customer_name: 'テスト予約', email: null, phone: null, note: null },
  });
  expect(sendBookingConfirmed).not.toHaveBeenCalled();
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ recordId: BOOKING,
    newValues: { booking_date: '2026-07-01', start_time: '10:00', status: 'confirmed' } }));
});
test('再送時は同じ予約を200で返すが再送信／監査の二重記録をしない', async () => {
  mockRpc.mockResolvedValue({ data: { ...saved, replayed: true }, error: null });
  const res = await POST(request(body({ email: 'test@example.invalid' })) as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, id: BOOKING, replayed: true, notification: 'not_repeated' });
  expect(sendBookingConfirmed).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('原子的に通知予約済みと返し、APIから非原子的な実メールを送らない', async () => {
  mockRpc.mockResolvedValue({ data: { ...saved, staff_name: null }, error: null });
  const res = await POST(request(body({ email: 'test@example.invalid' })) as never);
  expect(res.status).toBe(201);
  expect((await res.json()).notification).toBe('queued');
  expect(sendBookingConfirmed).not.toHaveBeenCalled();
});
test('予期しない例外は500', async () => {
  mockRpc.mockRejectedValueOnce(new Error('network unknown'));
  expect((await POST(request(body()) as never)).status).toBe(500);
});
function recovery(params = 'operation_id=' + OP + '&facility_id=' + FACILITY) {
  return new Request('http://localhost/api/admin/bookings?' + params);
}
test('原操作の照合は本人IDを使い、顧客情報を応答せずキャッシュさせない', async () => {
  mockRpc.mockResolvedValue({ data: { state: 'saved', booking_id: BOOKING, customer_name: 'not exposed' }, error: null });
  const res = await GET(recovery() as never);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({ state: 'saved', booking_id: BOOKING });
  expect(mockRpc).toHaveBeenCalledWith('get_manual_booking_operation', { p_actor_id: ACTOR,
    p_operation_id: OP, p_facility_id: FACILITY });
});
test.each(['absent', 'retired'])('原操作状態 %s を保持', async state => {
  mockRpc.mockResolvedValue({ data: { state }, error: null });
  expect(await (await GET(recovery() as never)).json()).toEqual({ state });
});
test('照合の入力・認証・認可・DB異常・不正な結果・例外を拒否', async () => {
  (checkRateLimit as jest.Mock).mockReturnValueOnce(true);
  expect((await GET(recovery() as never)).status).toBe(429);
  expect((await GET(recovery('') as never)).status).toBe(400);
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await GET(recovery() as never)).status).toBe(401);
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
  expect((await GET(recovery() as never)).status).toBe(403);
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'DB failure' } });
  expect((await GET(recovery() as never)).status).toBe(500);
  mockRpc.mockResolvedValueOnce({ data: { state: 'saved', booking_id: 'bad' }, error: null });
  expect((await GET(recovery() as never)).status).toBe(500);
  mockRpc.mockRejectedValueOnce(new Error('network unknown'));
  expect((await GET(recovery() as never)).status).toBe(500);
});
