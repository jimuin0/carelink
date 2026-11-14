/**
 * @jest-environment node
 *
 * POST /api/options/checkout（有料オプションの月額・PAY.JP・2026年11月14日に Stripe から移行）。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlert(...a) }));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
let mockDb: ReturnType<typeof import('@/test-utils/fake-supabase').createFakeSupabase>;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb.client }));
const mockPayjp = { createSubscription: jest.fn() };
jest.mock('@/lib/payjp', () => ({ ...jest.requireActual('@/lib/payjp'), createSubscription: (...a: unknown[]) => mockPayjp.createSubscription(...a) }));
const mockCustomer = jest.fn();
jest.mock('@/lib/payjp-customer', () => ({ ...jest.requireActual('@/lib/payjp-customer'), ensureFacilityCustomer: (...a: unknown[]) => mockCustomer(...a) }));
const mockPlan = jest.fn();
const mockApply = jest.fn();
jest.mock('@/lib/options-payjp', () => ({
  ensureOptionPlan: (...a: unknown[]) => mockPlan(...a),
  applyOptionSubscription: (...a: unknown[]) => mockApply(...a),
}));

import { POST } from '../route';
import { PayjpError } from '@/lib/payjp';
import { createFakeSupabase, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const FAC = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const ENV = { ...process.env };
const SUB = { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: 1, metadata: {} };

type Opts = Partial<Record<'member' | 'option' | 'current' | 'link' | 'del', FakeResult>>;
function db(opts: Opts = {}) {
  mockDb = createFakeSupabase((call: FakeCall) => {
    if (call.table === 'facility_members') return opts.member ?? { data: { role: 'owner' } };
    if (call.table === 'option_catalog') return opts.option ?? { data: { key: 'reminder_line', name: 'LINE', monthly_price: 1500, contact_only: false, is_active: true } };
    if (call.op === 'select') return opts.current ?? { data: null };
    if (call.op === 'upsert') return opts.link;
    return opts.del;
  });
}
const req = (body: unknown) => new Request('http://localhost/api/options/checkout', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const BODY = { facilityId: FAC, optionKey: 'reminder_line', token: 'tok_abc' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, PAYJP_SECRET_KEY: 'sk', PAYJP_WEBHOOK_TOKEN: 'wh', NEXT_PUBLIC_PAYJP_PUBLIC_KEY: 'pk' };
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockPlan.mockResolvedValue({ id: 'carelink_option_reminder_line_1500' });
  mockCustomer.mockResolvedValue({ ok: true, customerId: 'cus_1' });
  mockPayjp.createSubscription.mockResolvedValue(SUB);
  mockApply.mockResolvedValue('applied');
  db();
});
afterAll(() => { process.env = ENV; });

test('決済が未設定なら 503', async () => {
  delete process.env.NEXT_PUBLIC_PAYJP_PUBLIC_KEY;
  expect((await POST(req(BODY))).status).toBe(503);
});
test.each([['JSON でない', 'x'], ['トークンが無い', { facilityId: FAC, optionKey: 'reminder_line' }], ['キーの形が違う', { ...BODY, optionKey: 'A B' }], ['価格を送ってくる', { ...BODY, price: 1 }]])('%sは 400', async (_l, body) => {
  expect((await POST(req(body))).status).toBe(400);
});
test('定期課金を作り、すぐ有効になれば active を返す', async () => {
  const res = await POST(req(BODY));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ subscribed: true, active: true });
  expect(mockPlan).toHaveBeenCalledWith('reminder_line', 1500, 'LINE');
  expect(mockPayjp.createSubscription).toHaveBeenCalledWith('cus_1', 'carelink_option_reminder_line_1500', { facility_id: FAC, option_key: 'reminder_line' });
  expect(mockApply).toHaveBeenCalledWith(mockDb.client, 'subscription.created', SUB, expect.any(Date));
  const upsert = mockDb.calls.find((c) => c.op === 'upsert')!;
  expect(upsert.payload).toMatchObject({ facility_id: FAC, option_key: 'reminder_line', payjp_customer_id: 'cus_1', status: 'pending', payjp_subscription_id: null });
});
test('試用など active でなければ active=false', async () => {
  mockPayjp.createSubscription.mockResolvedValue({ ...SUB, status: 'trial' });
  expect(await (await POST(req(BODY))).json()).toEqual({ subscribed: true, active: false });
});
test('反映に失敗しても成功を返し、運営に知らせる（webhook が反映する）', async () => {
  mockApply.mockRejectedValue(new Error('db'));
  const res = await POST(req(BODY));
  expect(await res.json()).toEqual({ subscribed: true, active: false });
  expect(mockAlert).toHaveBeenCalledWith('options-checkout-apply', expect.any(Error), '/api/options/checkout');
});
test.each([
  ['所属の読み取り失敗', { member: { error: { message: 'x' } } }, 500],
  ['所属なし', { member: { data: null } }, 403],
  ['カタログの読み取り失敗', { option: { error: { message: 'x' } } }, 500],
  ['オプションが無い', { option: { data: null } }, 404],
  ['停止中のオプション', { option: { data: { key: 'k', name: 'n', monthly_price: 1500, contact_only: false, is_active: false } } }, 404],
  ['申込み専用', { option: { data: { key: 'k', name: 'n', monthly_price: 1500, contact_only: true, is_active: true } } }, 400],
  ['価格未設定', { option: { data: { key: 'k', name: 'n', monthly_price: 0, contact_only: false, is_active: true } } }, 400],
  ['契約の読み取り失敗', { current: { error: { message: 'x' } } }, 500],
  ['契約中', { current: { data: { status: 'active', created_at: new Date().toISOString() } } }, 409],
  ['申込処理中（30 分以内）', { current: { data: { status: 'pending', created_at: new Date().toISOString() } } }, 409],
])('%s → %s（課金しない）', async (_l, opts, status) => {
  db(opts as Opts);
  expect((await POST(req(BODY))).status).toBe(status);
  expect(mockPayjp.createSubscription).not.toHaveBeenCalled();
});
test.each([['古い pending', 'pending'], ['終了した契約', 'deleted']])('%sは申し込み直せる', async (_l, status) => {
  db({ current: { data: { status, created_at: '2026-01-01T00:00:00Z' } } });
  expect((await POST(req(BODY))).status).toBe(200);
});
test('プランを用意できなければ 500', async () => {
  mockPlan.mockRejectedValue(new Error('mismatch'));
  expect((await POST(req(BODY))).status).toBe(500);
  expect(mockCustomer).not.toHaveBeenCalled();
});
test('カード拒否は 400、customer の障害は 500', async () => {
  mockCustomer.mockResolvedValue({ ok: false, reason: 'card' });
  expect((await POST(req(BODY))).status).toBe(400);
  mockCustomer.mockResolvedValue({ ok: false, reason: 'error', tag: 'customer', error: new Error('x') });
  expect((await POST(req(BODY))).status).toBe(500);
});
test('pending 行の保存失敗は 500（定期課金を作らない）', async () => {
  db({ link: { error: { message: 'x' } } });
  expect((await POST(req(BODY))).status).toBe(500);
  expect(mockPayjp.createSubscription).not.toHaveBeenCalled();
});
test.each([['カード拒否', new PayjpError('declined', 402, 'card_error'), 400], ['PAY.JP 障害', new PayjpError('down', 500), 500]])('定期課金の作成で%s → %s、pending を消す', async (_l, err, status) => {
  mockPayjp.createSubscription.mockRejectedValue(err);
  expect((await POST(req(BODY))).status).toBe(status);
  expect(mockDb.calls.some((c) => c.op === 'delete')).toBe(true);
});
