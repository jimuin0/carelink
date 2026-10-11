/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/booking-checkout（退店レジ会計・Phase B）。
 * 明細検証・合計再計算・お預かり/お釣り・CAS・completed 進入時の副作用付与を網羅。
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

const mockApply = jest.fn(() => Promise.resolve(0));
jest.mock('@/lib/booking-completion', () => ({
  applyCompletionSideEffects: (...args: unknown[]) => mockApply(...args),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

const validBookingId = '123e4567-e89b-12d3-a456-426614174000';
const facilityId = 'fac00000-0000-0000-0000-000000000001';
const userId = 'user-admin-1';

const bookingBase = {
  id: validBookingId, facility_id: facilityId, user_id: 'customer-1',
  customer_name: 'テスト', email: 'c@example.com', booking_date: '2026-05-01',
  menu_id: null, staff_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
});

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/admin/booking-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

function validBody(over: Record<string, unknown> = {}) {
  return { bookingId: validBookingId, items: [{ type: 'menu', name: 'カット', amount: 3300 }], ...over };
}

/** 予約取得 .select().eq().single() */
function fluentBooking(data: unknown) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self); chain.eq = jest.fn(self);
  chain.single = jest.fn(() => Promise.resolve({ data }));
  return chain;
}
/** membership .select().eq().eq().in().maybeSingle().then(r=>r.data) */
function membershipChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data })),
    then: jest.fn((fn: (v: unknown) => unknown) => Promise.resolve({ data }).then(fn)),
  };
}
/** CAS update .update().eq().eq().eq().select() */
function updateChain(result: { data: unknown; error: unknown }) {
  const selectFn = jest.fn(() => Promise.resolve(result));
  const eq3 = jest.fn(() => ({ select: selectFn }));
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  return { update: jest.fn(() => ({ eq: eq1 })) };
}

/** 標準成功モック: status=fromStatus の予約・owner・CAS 成功。 */
function setupSuccess(fromStatus: string, updateResult?: { data: unknown; error: unknown }) {
  mockRpc.mockImplementation((_name, args) => Promise.resolve(updateResult ?? { data: [{ id: validBookingId, total_price: Math.max(0,args.p_charges.reduce((sum: number,c: {amount:number})=>sum+c.amount,0)), points_earned: 33 }], error: null }));
  let bookingCall = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      bookingCall++;
      if (bookingCall === 1) return fluentBooking({ ...bookingBase, status: fromStatus });
      return updateChain(updateResult ?? { data: [{ id: validBookingId }], error: null });
    }
    if (table === 'facility_members') return membershipChain({ facility_id: facilityId, role: 'owner' });
    return fluentBooking(null);
  });
}

// ─── ガード ─────────────────────────────────────────────
test('CSRF 失敗 → 403', async () => {
  const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('bookingId なし → 400', async () => {
  const res = await POST(makeRequest({ items: [{ type: 'menu', name: 'x', amount: 1 }] }));
  expect(res.status).toBe(400);
});

test('bookingId 不正 → 400', async () => {
  const res = await POST(makeRequest(validBody({ bookingId: 'bad' })));
  expect(res.status).toBe(400);
});

// ─── 明細(parseItems)検証 ────────────────────────────────
test.each([
  ['items が配列でない', { items: 'x' }],
  ['items 空配列', { items: [] }],
  ['items 上限超過', { items: Array.from({ length: 51 }, () => ({ type: 'menu', name: 'x', amount: 1 })) }],
  ['item が object でない', { items: [null] }],
  ['type 不正', { items: [{ type: 'unknown', name: 'x', amount: 1 }] }],
  ['name 空', { items: [{ type: 'menu', name: '  ', amount: 1 }] }],
  ['name 長すぎ', { items: [{ type: 'menu', name: 'あ'.repeat(101), amount: 1 }] }],
  ['amount が文字列', { items: [{ type: 'menu', name: 'x', amount: '100' }] }],
  ['amount が非整数', { items: [{ type: 'menu', name: 'x', amount: 1.5 }] }],
  ['amount が無限大', { items: [{ type: 'menu', name: 'x', amount: Infinity }] }],
  ['amount が上限超過', { items: [{ type: 'menu', name: 'x', amount: 100_000_001 }] }],
])('明細不正(%s) → 400', async (_label, over) => {
  const res = await POST(makeRequest(validBody(over)));
  expect(res.status).toBe(400);
});

test('paid_amount 不正(負) → 400', async () => {
  const res = await POST(makeRequest(validBody({ paid_amount: -1 })));
  expect(res.status).toBe(400);
});

test('paid_amount 不正(非整数) → 400', async () => {
  const res = await POST(makeRequest(validBody({ paid_amount: 1.5 })));
  expect(res.status).toBe(400);
});

// ─── 認証・認可 ──────────────────────────────────────────
test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('予約が存在しない → 404', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return fluentBooking(null);
    return membershipChain(null);
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(404);
});

test('施設メンバーでない → 404', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return fluentBooking({ ...bookingBase, status: 'confirmed' });
    return membershipChain(null);
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(404);
});

// ─── ステータス前提 ──────────────────────────────────────
test.each(['pending', 'completed', 'cancelled', 'no_show'])('status=%s は会計不可 → 400', async (st) => {
  setupSuccess(st);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(400);
});

// ─── 正常系 ──────────────────────────────────────────────
test('confirmed・complete=false → 200・明細保存・完了副作用なし', async () => {
  setupSuccess('confirmed');
  const res = await POST(makeRequest(validBody({ items: [
    { type: 'menu', name: 'カット', amount: 3300 },
    { type: 'retail', name: 'シャンプー', amount: 2200 },
  ] })));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total_price).toBe(5500);
  expect(body.change).toBeNull();
  expect(mockApply).not.toHaveBeenCalled();
});

test('arrived・complete=true → 200・最終金額で完了副作用を付与', async () => {
  setupSuccess('arrived');
  const res = await POST(makeRequest(validBody({
    items: [{ type: 'menu', name: 'カラー', amount: 8800 }],
    paid_amount: 10000,
    complete: true,
  })));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total_price).toBe(8800);
  expect(body.change).toBe(1200); // お釣り
  expect(mockApply).toHaveBeenCalledTimes(1);
  // 最終金額(total)が来店記録の amount に渡る
  expect(mockApply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ total_price: 8800 }));
});

test('割引で合計が負 → 0 にクランプ', async () => {
  setupSuccess('confirmed');
  const res = await POST(makeRequest(validBody({ items: [
    { type: 'menu', name: 'カット', amount: 3000 },
    { type: 'discount', name: '全額割引', amount: -5000 },
  ] })));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.total_price).toBe(0);
});

// ─── CAS / DB エラー ─────────────────────────────────────
test('CAS 競合はtransactionで拒否 → 409', async () => {
  setupSuccess('confirmed', { data: null, error: {message:'BOOKING_REVISION_CONFLICT'} });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(409);
});

test('更新エラー → 500', async () => {
  setupSuccess('confirmed', { data: null, error: { message: 'db error' } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('予期せぬ例外 → 500（catch）', async () => {
  mockGetUser.mockRejectedValue(new Error('boom'));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});


test.each([['BOOKING_PERMISSION_DENIED',404],['BOOKING_REVISION_CONFLICT',409],['SYNTHETIC_POINT_FAILURE',500]])('原子会計 %s は副作用なし',async(message,status)=>{
 setupSuccess('confirmed',{data:null,error:{message}});
 expect((await POST(makeRequest(validBody({complete:true})))).status).toBe(status);
 expect(mockApply).not.toHaveBeenCalled();
});
test.each([null,[],[{id:'wrong',total_price:3300}],[{id:validBookingId,total_price:999}]])('会計結果未確認 %j は成功にしない',async(data)=>{
 setupSuccess('confirmed',{data,error:null}); expect((await POST(makeRequest(validBody()))).status).toBe(500);
});

test('旧DBで原子会計RPCが未適用でも直接UPDATE/ポイント副作用へ戻らない',async()=>{
 setupSuccess('confirmed');
 mockRpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'checkout_booking_with_points_atomic was not found'}});
 expect((await POST(makeRequest(validBody({complete:true})))).status).toBe(500);
 expect(mockRpc).toHaveBeenCalledWith('checkout_booking_with_points_atomic',expect.anything());
 expect(mockFrom.mock.calls.filter(([table])=>table==='bookings')).toHaveLength(1);
 expect(mockFrom).not.toHaveBeenCalledWith('user_points');expect(mockFrom).not.toHaveBeenCalledWith('customer_visits');
 expect(mockApply).not.toHaveBeenCalled();
 expect(jest.requireMock('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();
});
