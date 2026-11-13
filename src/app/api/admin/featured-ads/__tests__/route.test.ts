/**
 * @jest-environment node
 *
 * GET / POST / DELETE /api/admin/featured-ads（2026年11月13日・点検 B2-1：PAY.JP の月額サブスク）。
 * PAY.JP への通信は @/lib/payjp の通信関数をモックする（金額判定・カードエラー判定は本物を使う）。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })) }));
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlert(...a) }));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
let mockDb: ReturnType<typeof import('@/test-utils/fake-supabase').createFakeSupabase>;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb.client }));
const mockPayjp = { retrievePlan: jest.fn(), createCustomer: jest.fn(), addDefaultCard: jest.fn(), createSubscription: jest.fn(), cancelSubscription: jest.fn() };
jest.mock('@/lib/payjp', () => ({
  ...jest.requireActual('@/lib/payjp'),
  retrievePlan: (...a: unknown[]) => mockPayjp.retrievePlan(...a),
  createCustomer: (...a: unknown[]) => mockPayjp.createCustomer(...a),
  addDefaultCard: (...a: unknown[]) => mockPayjp.addDefaultCard(...a),
  createSubscription: (...a: unknown[]) => mockPayjp.createSubscription(...a),
  cancelSubscription: (...a: unknown[]) => mockPayjp.cancelSubscription(...a),
}));

import { GET, POST, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { PayjpError } from '@/lib/payjp';
import { createFakeSupabase, eqOf, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const FAC = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
const ENV = { ...process.env };
const PLAN = { id: 'pln_featured', amount: 10780, currency: 'jpy', interval: 'month' };

type Opts = Partial<Record<
  'member' | 'slots' | 'billing' | 'current' | 'customer' | 'customerInsert' | 'slotInsert' | 'slotDelete'
  | 'linkInsert' | 'linkSave' | 'cancelRead' | 'cancelMark', FakeResult>>;

function db(opts: Opts = {}) {
  mockDb = createFakeSupabase((call: FakeCall) => {
    switch (call.table) {
      case 'facility_members': return opts.member ?? { data: { facility_id: FAC } };
      case 'featured_slots':
        if (call.op === 'select') return opts.slots ?? { data: [{ id: SLOT, is_active: true }] };
        if (call.op === 'insert') return opts.slotInsert ?? { data: { id: SLOT, is_active: false } };
        if (call.op === 'delete') return opts.slotDelete;
        return undefined;
      case 'facility_payjp_customers':
        if (call.op === 'select') return opts.customer ?? { data: null };
        return opts.customerInsert;
      case 'featured_slot_payjp_subscriptions':
        if (call.op === 'insert') return opts.linkInsert;
        if (call.op === 'update') return (call.payload as { status?: string }).status === 'canceled' ? opts.cancelMark : opts.linkSave;
        if (eqOf(call, 'slot_id') !== undefined) return opts.cancelRead ?? { data: { payjp_subscription_id: 'sub_1', status: 'active' } };
        if (call.filters.some(([op]) => op === 'in')) return opts.current ?? { data: [] };
        return opts.billing ?? { data: [{ slot_id: SLOT, status: 'active', current_period_end: '2026-12-13T00:00:00Z' }] };
      default: return undefined;
    }
  });
}
const calls = (table: string, op?: string) => mockDb.calls.filter((c) => c.table === table && (!op || c.op === op));

const getReq = (fid: string | null = FAC) => new Request(`http://localhost/api/admin/featured-ads${fid === null ? '' : `?facility_id=${fid}`}`);
const postReq = (body: unknown = { facility_id: FAC, token: 'tok_abc123', area: '豊中市', business_type: '' }) => new Request('http://localhost/api/admin/featured-ads', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const delReq = (fid: string | null = FAC, sid: string | null = SLOT) => {
  const q = new URLSearchParams();
  if (fid !== null) q.set('facility_id', fid);
  if (sid !== null) q.set('slot_id', sid);
  return new Request(`http://localhost/api/admin/featured-ads?${q}`, { method: 'DELETE' });
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, PAYJP_SECRET_KEY: 'sk_test', PAYJP_WEBHOOK_TOKEN: 'whook', NEXT_PUBLIC_PAYJP_PUBLIC_KEY: 'pk_test_pub', PAYJP_FEATURED_PLAN_ID: 'pln_featured' };
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockPayjp.retrievePlan.mockResolvedValue(PLAN);
  mockPayjp.createCustomer.mockResolvedValue({ id: 'cus_new' });
  mockPayjp.addDefaultCard.mockResolvedValue({ id: 'car_1' });
  mockPayjp.createSubscription.mockResolvedValue({ id: 'sub_new', status: 'active' });
  mockPayjp.cancelSubscription.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
  db();
});
afterAll(() => { process.env = ENV; });

describe('GET', () => {
  test('枠と決済状態・販売情報（税込月額・公開鍵）を返す', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toEqual([{ id: SLOT, is_active: true, billing_status: 'active', current_period_end: '2026-12-13T00:00:00Z' }]);
    expect(body.sales).toEqual({ enabled: true, publicKey: 'pk_test_pub', priceTaxExcluded: 9800, priceTaxIncluded: 10780 });
  });

  test('PAY.JP の設定が欠けていれば販売しない（準備中の見え方）', async () => {
    delete process.env.PAYJP_WEBHOOK_TOKEN;
    db({ slots: { data: null }, billing: { data: null } });
    const body = await (await GET(getReq())).json();
    expect(body).toEqual({ slots: [], sales: { enabled: false } });
  });

  test('決済の行が無い枠は billing_status=null', async () => {
    db({ billing: { data: [] } });
    const body = await (await GET(getReq())).json();
    expect(body.slots[0]).toMatchObject({ billing_status: null, current_period_end: null });
  });

  test.each([null, 'bad'])('facility_id %p は 400', async (fid) => { expect((await GET(getReq(fid))).status).toBe(400); });
  test('所属が無ければ 403', async () => { db({ member: { data: null } }); expect((await GET(getReq())).status).toBe(403); });
  test.each([
    ['所属', { member: { error: { message: 'db' } } }],
    ['枠', { slots: { error: { message: 'db' } } }],
    ['決済状態', { billing: { error: { message: 'db' } } }],
  ])('%sの読み取り失敗は 500', async (_l, opts) => { db(opts as Opts); expect((await GET(getReq())).status).toBe(500); });
  test('未ログインは 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await GET(getReq())).status).toBe(401); });
});

describe('POST（申込）', () => {
  test('新しい customer を作り、有効化待ちの枠と定期課金を作る（掲載は webhook が始める）', async () => {
    const res = await POST(postReq());
    expect(res.status).toBe(201);
    expect((await res.json()).slot).toMatchObject({ id: SLOT, is_active: false, billing_status: 'pending' });
    expect(mockPayjp.retrievePlan).toHaveBeenCalledWith('pln_featured');
    expect(mockPayjp.createCustomer).toHaveBeenCalledWith('tok_abc123', FAC);
    expect(calls('facility_payjp_customers', 'insert')[0].payload).toEqual({ facility_id: FAC, payjp_customer_id: 'cus_new' });
    expect(calls('featured_slots', 'insert')[0].payload).toMatchObject({ facility_id: FAC, slot_type: 'search_top', area: '豊中市', business_type: null, budget_yen: 10780, is_active: false });
    expect(calls('featured_slot_payjp_subscriptions', 'insert')[0].payload).toEqual({ slot_id: SLOT, facility_id: FAC, payjp_customer_id: 'cus_new', status: 'pending' });
    expect(mockPayjp.createSubscription).toHaveBeenCalledWith('cus_new', 'pln_featured', { slot_id: SLOT, facility_id: FAC });
    expect(calls('featured_slot_payjp_subscriptions', 'update')[0].payload).toMatchObject({ payjp_subscription_id: 'sub_new' });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', recordId: SLOT, facilityId: FAC }));
  });

  test('既存の customer にはカードを差し替えて使う', async () => {
    db({ customer: { data: { payjp_customer_id: 'cus_old' } } });
    expect((await POST(postReq({ facility_id: FAC, token: 'tok_abc123' }))).status).toBe(201);
    expect(mockPayjp.addDefaultCard).toHaveBeenCalledWith('cus_old', 'tok_abc123');
    expect(mockPayjp.createCustomer).not.toHaveBeenCalled();
    expect(mockPayjp.createSubscription).toHaveBeenCalledWith('cus_old', 'pln_featured', expect.anything());
  });

  test('PAY.JP の設定が欠けていれば 404（PAY.JP に通信しない）', async () => {
    delete process.env.NEXT_PUBLIC_PAYJP_PUBLIC_KEY;
    expect((await POST(postReq())).status).toBe(404);
    expect(mockPayjp.retrievePlan).not.toHaveBeenCalled();
  });

  test.each([
    ['JSON でない', 'x'],
    ['トークンが無い', { facility_id: FAC }],
    ['トークンの形が違う（カード番号など）', { facility_id: FAC, token: '4242424242424242' }],
    ['余計な項目', { facility_id: FAC, token: 'tok_a', amount: 1 }],
    ['施設 ID が不正', { facility_id: 'x', token: 'tok_a' }],
  ])('%sは 400', async (_l, body) => {
    expect((await POST(postReq(body))).status).toBe(400);
    expect(mockPayjp.retrievePlan).not.toHaveBeenCalled();
  });

  test('所属が無ければ 403・所属の確認失敗は 500', async () => {
    db({ member: { data: null } });
    expect((await POST(postReq())).status).toBe(403);
    db({ member: { error: { message: 'db' } } });
    expect((await POST(postReq())).status).toBe(500);
  });

  test.each(['active', 'paused', 'canceled', 'trial'])('契約（%s）がある店舗は 409（二重課金しない）', async (status) => {
    db({ current: { data: [{ status, created_at: '2020-01-01T00:00:00Z' }] } });
    expect((await POST(postReq())).status).toBe(409);
    expect(mockPayjp.createSubscription).not.toHaveBeenCalled();
  });

  test('申込処理中（30 分以内の pending）があれば 409、古い pending は妨げない', async () => {
    db({ current: { data: [{ status: 'pending', created_at: new Date().toISOString() }] } });
    expect((await POST(postReq())).status).toBe(409);
    db({ current: { data: [{ status: 'pending', created_at: '2020-01-01T00:00:00Z' }] } });
    expect((await POST(postReq())).status).toBe(201);
  });

  test('契約状況の読み取り失敗は 500・契約状況が null でも続行', async () => {
    db({ current: { error: { message: 'db' } } });
    expect((await POST(postReq())).status).toBe(500);
    db({ current: { data: null } });
    expect((await POST(postReq())).status).toBe(201);
  });

  test('プラン金額が税込表示と食い違えば売らない（500・通知）', async () => {
    mockPayjp.retrievePlan.mockResolvedValue({ ...PLAN, amount: 9800 });
    const res = await POST(postReq());
    expect(res.status).toBe(500);
    expect(mockAlert).toHaveBeenCalledWith('admin-featured-ads-plan-mismatch', expect.any(Error), '/api/admin/featured-ads');
    expect(mockPayjp.createCustomer).not.toHaveBeenCalled();
  });

  test('プランを取得できなければ 500', async () => {
    mockPayjp.retrievePlan.mockRejectedValue(new PayjpError('down', 503));
    expect((await POST(postReq())).status).toBe(500);
    expect(mockPayjp.createCustomer).not.toHaveBeenCalled();
  });

  test('customer の読み取り失敗は 500', async () => {
    db({ customer: { error: { message: 'db' } } });
    expect((await POST(postReq())).status).toBe(500);
  });

  test.each([['作成', 'createCustomer', {}], ['カード差し替え', 'addDefaultCard', { customer: { data: { payjp_customer_id: 'cus_old' } } }]])('カード拒否（%s）は 400・枠を作らない', async (_l, fn, opts) => {
    db(opts as Opts);
    (mockPayjp as Record<string, jest.Mock>)[fn].mockRejectedValue(new PayjpError('declined', 402, 'card_error'));
    const res = await POST(postReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('カードを利用できませんでした');
    expect(calls('featured_slots', 'insert')).toHaveLength(0);
  });

  test('customer 作成で PAY.JP 障害なら 500', async () => {
    mockPayjp.createCustomer.mockRejectedValue(new PayjpError('down', 500, 'server_error'));
    expect((await POST(postReq())).status).toBe(500);
  });

  test('customer の保存失敗は 500（孤児の customer ID を通知に残す）', async () => {
    db({ customerInsert: { error: { message: 'dup' } } });
    expect((await POST(postReq())).status).toBe(500);
    expect(String(mockAlert.mock.calls[0][1].message)).toContain('cus_new');
    expect(calls('featured_slots', 'insert')).toHaveLength(0);
  });

  test.each([[{ error: { message: 'db' } }], [{ data: null }]])('枠の作成失敗は 500 %#', async (slotInsert) => {
    db({ slotInsert });
    expect((await POST(postReq())).status).toBe(500);
    expect(mockPayjp.createSubscription).not.toHaveBeenCalled();
  });

  test('決済の行の作成失敗は 500・枠を消す', async () => {
    db({ linkInsert: { error: { message: 'db' } } });
    expect((await POST(postReq())).status).toBe(500);
    expect(calls('featured_slots', 'delete')).toHaveLength(1);
    expect(mockPayjp.createSubscription).not.toHaveBeenCalled();
  });

  test('定期課金がカードで拒否されたら 400・未有効の枠を消す', async () => {
    mockPayjp.createSubscription.mockRejectedValue(new PayjpError('declined', 402));
    expect((await POST(postReq())).status).toBe(400);
    const del = calls('featured_slots', 'delete')[0];
    expect(eqOf(del, 'id')).toBe(SLOT);
    expect(eqOf(del, 'is_active')).toBe(false);
  });

  test('定期課金の作成が PAY.JP 障害なら 500・枠を消す（消せなくても応答は 500）', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db({ slotDelete: { error: { message: 'db' } } });
    mockPayjp.createSubscription.mockRejectedValue(new PayjpError('down', 500));
    expect((await POST(postReq())).status).toBe(500);
    expect(spy).toHaveBeenCalledWith('[featured-ads] orphan slot cleanup failed', { slotId: SLOT });
    spy.mockRestore();
  });

  test('定期課金 ID の保存に失敗しても請求は始まっているので 201・運営に通知（webhook が metadata で補う）', async () => {
    db({ linkSave: { error: { message: 'db' } } });
    expect((await POST(postReq())).status).toBe(201);
    expect(mockAlert).toHaveBeenCalledWith('admin-featured-ads-subscription-save', expect.any(Error), '/api/admin/featured-ads');
  });

  test('レート制限は 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    expect((await POST(postReq())).status).toBe(429);
  });
});

describe('DELETE（期間末で解約）', () => {
  test('契約中の定期課金を解約し、解約予約済みを記録する', async () => {
    const res = await DELETE(delReq());
    expect(res.status).toBe(200);
    expect(mockPayjp.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(calls('featured_slot_payjp_subscriptions', 'update')[0].payload).toMatchObject({ status: 'canceled' });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel', recordId: SLOT }));
  });

  test('PAY.JP の設定が欠けていれば 404', async () => {
    delete process.env.PAYJP_SECRET_KEY;
    expect((await DELETE(delReq())).status).toBe(404);
  });

  test.each([[null, SLOT], [FAC, null], ['bad', SLOT], [FAC, 'bad']])('ID 不正（%p, %p）は 400', async (f, s) => {
    expect((await DELETE(delReq(f, s))).status).toBe(400);
  });

  test('所属が無ければ 403・確認失敗は 500', async () => {
    db({ member: { data: null } });
    expect((await DELETE(delReq())).status).toBe(403);
    db({ member: { error: { message: 'db' } } });
    expect((await DELETE(delReq())).status).toBe(500);
  });

  test.each([
    [{ data: null }],
    [{ data: { payjp_subscription_id: null, status: 'pending' } }],
    [{ data: { payjp_subscription_id: 'sub_1', status: 'canceled' } }],
  ])('解約できる契約が無ければ 404 %#', async (cancelRead) => {
    db({ cancelRead });
    expect((await DELETE(delReq())).status).toBe(404);
    expect(mockPayjp.cancelSubscription).not.toHaveBeenCalled();
  });

  test('契約の読み取り失敗は 500', async () => {
    db({ cancelRead: { error: { message: 'db' } } });
    expect((await DELETE(delReq())).status).toBe(500);
  });

  test('PAY.JP の解約に失敗したら 500・記録しない', async () => {
    mockPayjp.cancelSubscription.mockRejectedValue(new PayjpError('down', 500));
    expect((await DELETE(delReq())).status).toBe(500);
    expect(calls('featured_slot_payjp_subscriptions', 'update')).toHaveLength(0);
  });

  test('解約予約の記録に失敗しても解約自体は済んでいるので 200・通知', async () => {
    db({ cancelMark: { error: { message: 'db' } } });
    expect((await DELETE(delReq())).status).toBe(200);
    expect(mockAlert).toHaveBeenCalledWith('admin-featured-ads-cancel-mark', expect.anything(), '/api/admin/featured-ads');
  });
});
