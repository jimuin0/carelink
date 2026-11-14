/**
 * @jest-environment node
 *
 * POST /api/payment/charge（予約の前払い・PAY.JP・2026年11月14日）。
 * PAY.JP への通信は @/lib/payjp の createCharge をモックする（カードエラー判定は本物）。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlert(...a) }));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
let mockDb: ReturnType<typeof import('@/test-utils/fake-supabase').createFakeSupabase>;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb.client }));
const mockCharge = jest.fn();
jest.mock('@/lib/payjp', () => ({ ...jest.requireActual('@/lib/payjp'), createCharge: (...a: unknown[]) => mockCharge(...a) }));

import { POST } from '../route';
import { PayjpError } from '@/lib/payjp';
import { createFakeSupabase, eqOf, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const ENV = { ...process.env };

type Opts = Partial<Record<'booking' | 'facility' | 'insert' | 'paidRow' | 'bookingPaid' | 'confirm' | 'failed', FakeResult>>;
function db(opts: Opts = {}) {
  mockDb = createFakeSupabase((call: FakeCall) => {
    if (call.table === 'facility_profiles') return opts.facility ?? { data: { name: 'Salon', deposit_type: 'fixed', deposit_amount: 1000 } };
    if (call.table === 'booking_payjp_charges') {
      if (call.op === 'insert') return opts.insert ?? { data: { id: 'pay-1', booking_id: BOOKING, amount: (call.payload as { amount: number }).amount, payment_type: (call.payload as { payment_type: string }).payment_type, status: 'pending' } };
      if ((call.payload as { status?: string }).status === 'failed') return opts.failed;
      return opts.paidRow;
    }
    if (call.op === 'select') return opts.booking ?? { data: { id: BOOKING, user_id: USER, status: 'pending', total_price: 5000, facility_id: 'fac-1', payment_status: 'unpaid' } };
    if ((call.payload as { status?: string }).status === 'confirmed') return opts.confirm;
    return opts.bookingPaid ?? { data: [{ id: BOOKING }] };
  });
}
const req = (body: unknown) => new Request('http://localhost/api/payment/charge', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const BODY = { bookingId: BOOKING, token: 'tok_abc' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, PAYJP_SECRET_KEY: 'sk', PAYJP_WEBHOOK_TOKEN: 'wh', NEXT_PUBLIC_PAYJP_PUBLIC_KEY: 'pk' };
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockCharge.mockResolvedValue({ id: 'ch_1', paid: true });
  db();
});
afterAll(() => { process.env = ENV; });

test('決済が未設定なら 503', async () => {
  delete process.env.PAYJP_SECRET_KEY;
  expect((await POST(req(BODY))).status).toBe(503);
});
test('未ログインは 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(req(BODY))).status).toBe(401);
});
test.each([['JSON でない', 'x'], ['トークンの形が違う', { ...BODY, token: '4242' }], ['余計な項目', { ...BODY, amount: 1 }], ['種別が違う', { ...BODY, paymentType: 'tip' }]])('%sは 400', async (_l, body) => {
  expect((await POST(req(body))).status).toBe(400);
});
test('予約金額で支払いを作り、予約を支払い済みにする', async () => {
  const res = await POST(req(BODY));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ paid: true, paymentId: 'pay-1', amount: 5000 });
  expect(mockCharge).toHaveBeenCalledWith('tok_abc', 5000, 'Salon 予約料金', { payment_id: 'pay-1', booking_id: BOOKING, user_id: USER, payment_type: 'full' });
  const insert = mockDb.calls.find((c) => c.op === 'insert')!;
  expect(insert.payload).toMatchObject({ booking_id: BOOKING, user_id: USER, amount: 5000, payment_type: 'full', status: 'pending' });
  expect(mockDb.calls.some((c) => c.table === 'bookings' && (c.payload as { payment_status?: string })?.payment_status === 'paid')).toBe(true);
});
test('デポジットは店舗の設定額で、施設名が無くても作れる', async () => {
  db({ facility: { data: { name: null, deposit_type: 'fixed', deposit_amount: 1000 } } });
  await POST(req({ ...BODY, paymentType: 'deposit' }));
  expect(mockCharge).toHaveBeenCalledWith('tok_abc', 1000, 'CareLink デポジット', expect.objectContaining({ payment_type: 'deposit' }));
});
test.each([
  ['予約の読み取り失敗', { booking: { error: { message: 'x' } } }, 500],
  ['予約が無い', { booking: { data: null } }, 404],
  ['他人の予約', { booking: { data: { id: BOOKING, user_id: 'other', status: 'pending', total_price: 5000, facility_id: 'f', payment_status: 'unpaid' } } }, 403],
  ['キャンセル済み', { booking: { data: { id: BOOKING, user_id: USER, status: 'cancelled', total_price: 5000, facility_id: 'f', payment_status: 'unpaid' } } }, 409],
  ['支払い済み', { booking: { data: { id: BOOKING, user_id: USER, status: 'confirmed', total_price: 5000, facility_id: 'f', payment_status: 'paid' } } }, 409],
  ['施設の読み取り失敗', { facility: { error: { message: 'x' } } }, 500],
  ['店舗が前払いを設定していない', { facility: { data: { name: 'S', deposit_type: 'none', deposit_amount: 0 } } }, 400],
  ['処理中・支払い済みの行がある', { insert: { error: { code: '23505', message: 'dup' } } }, 409],
  ['行の作成失敗', { insert: { error: { message: 'x' } } }, 500],
  ['行が返らない', { insert: { data: null } }, 500],
])('%s → %s（課金しない）', async (_l, opts, status) => {
  db(opts as Opts);
  expect((await POST(req(BODY))).status).toBe(status);
  expect(mockCharge).not.toHaveBeenCalled();
});
test('カード拒否は 400、行を failed にする', async () => {
  mockCharge.mockRejectedValue(new PayjpError('declined', 402, 'card_error'));
  const res = await POST(req(BODY));
  expect(res.status).toBe(400);
  expect(mockDb.calls.some((c) => (c.payload as { status?: string })?.status === 'failed' && eqOf(c, 'id') === 'pay-1')).toBe(true);
});
test.each([['PAY.JP 障害', new PayjpError('down', 500)], ['未確定の支払い', null]])('%sは 500、行を pending のまま残す', async (_l, err) => {
  if (err) mockCharge.mockRejectedValue(err); else mockCharge.mockResolvedValue({ id: 'ch_1', paid: false });
  const res = await POST(req(BODY));
  expect(res.status).toBe(500);
  expect(mockDb.calls.some((c) => c.op === 'update')).toBe(false);
});
test.each([
  ['Error', { bookingPaid: { error: { message: 'x' } } }],
  ['0 件', { bookingPaid: { data: [] } }],
])('支払い後の反映失敗（%s）は 500 で、支払いが完了した旨を返す', async (_l, opts) => {
  db(opts as Opts);
  const res = await POST(req(BODY));
  expect(res.status).toBe(500);
  expect((await res.json()).error).toContain('お支払いは完了しました');
});
test('反映の失敗が Error でなくても 500', async () => {
  db();
  const original = mockDb.client.from;
  mockDb.client.from = ((t: string) => {
    if (t === 'booking_payjp_charges') {
      const b = original(t) as Record<string, unknown>;
      return { ...b, update: () => { throw 'boom'; }, insert: b.insert } as never;
    }
    return original(t);
  }) as never;
  const res = await POST(req(BODY));
  expect(res.status).toBe(500);
});
