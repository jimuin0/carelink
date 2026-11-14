/**
 * @jest-environment node
 *
 * GET / POST /api/options/subscription（有料オプションの契約状態と期間末解約・2026年11月14日）。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
const mockAudit = jest.fn();
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: (...a: unknown[]) => mockAudit(...a), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
let mockDb: ReturnType<typeof import('@/test-utils/fake-supabase').createFakeSupabase>;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb.client }));
const mockCancel = jest.fn();
jest.mock('@/lib/payjp', () => ({ ...jest.requireActual('@/lib/payjp'), cancelSubscription: (...a: unknown[]) => mockCancel(...a) }));

import { GET, POST } from '../route';
import { createFakeSupabase, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const FAC = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

type Opts = Partial<Record<'member' | 'list' | 'row' | 'mark', FakeResult>>;
function db(opts: Opts = {}) {
  mockDb = createFakeSupabase((call: FakeCall) => {
    if (call.table === 'facility_members') return opts.member ?? { data: { role: 'owner' } };
    if (call.op === 'update') return opts.mark;
    if (call.filters.some(([, k]) => k === 'option_key')) return opts.row ?? { data: { payjp_subscription_id: 'sub_1', status: 'active' } };
    return opts.list ?? { data: [{ option_key: 'reminder_line', status: 'active', current_period_end: null }] };
  });
}
const getReq = (q = `?facilityId=${FAC}`) => new Request(`http://localhost/api/options/subscription${q}`);
const postReq = (body: unknown) => new Request('http://localhost/api/options/subscription', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const BODY = { facilityId: FAC, optionKey: 'reminder_line' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockCancel.mockResolvedValue({ id: 'sub_1', status: 'canceled', current_period_end: 1_800_000_000 });
  db();
});

describe('GET', () => {
  test('自店の契約状態を返す', async () => {
    const res = await GET(getReq());
    expect(await res.json()).toEqual({ subscriptions: [{ option_key: 'reminder_line', status: 'active', current_period_end: null }] });
  });
  test('行が無ければ空配列', async () => {
    db({ list: { data: null } });
    expect(await (await GET(getReq())).json()).toEqual({ subscriptions: [] });
  });
  test.each([['施設 ID が無い', ''], ['形が違う', '?facilityId=x']])('%sは 400', async (_l, q) => {
    expect((await GET(getReq(q))).status).toBe(400);
  });
  test.each([
    ['所属の読み取り失敗', { member: { error: { message: 'x' } } }, 500],
    ['所属なし', { member: { data: null } }, 403],
    ['一覧の読み取り失敗', { list: { error: { message: 'x' } } }, 500],
  ])('%s → %s', async (_l, opts, status) => {
    db(opts as Opts);
    expect((await GET(getReq())).status).toBe(status);
  });
});

describe('POST', () => {
  test('期間末で解約し、表示用の状態を canceled にして監査ログを残す', async () => {
    const res = await POST(postReq(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canceled: true, periodEnd: new Date(1_800_000_000_000).toISOString() });
    expect(mockCancel).toHaveBeenCalledWith('sub_1');
    expect(mockDb.calls.find((c) => c.op === 'update')!.payload).toMatchObject({ status: 'canceled' });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel', facilityId: FAC, newValues: expect.objectContaining({ cancel_at_period_end: true }) }));
  });
  test('PAY.JP が期間末を返さなければ periodEnd は null', async () => {
    mockCancel.mockResolvedValue({ id: 'sub_1', status: 'canceled', current_period_end: null });
    expect(await (await POST(postReq(BODY))).json()).toEqual({ canceled: true, periodEnd: null });
  });
  test.each([['JSON でない', 'x'], ['キーの形が違う', { ...BODY, optionKey: 'A B' }], ['余計な項目', { ...BODY, x: 1 }]])('%sは 400', async (_l, body) => {
    expect((await POST(postReq(body))).status).toBe(400);
  });
  test.each([
    ['所属の読み取り失敗', { member: { error: { message: 'x' } } }, 500],
    ['所属なし', { member: { data: null } }, 403],
    ['契約の読み取り失敗', { row: { error: { message: 'x' } } }, 500],
    ['契約が無い', { row: { data: null } }, 409],
    ['定期課金 ID が無い（申込処理中）', { row: { data: { payjp_subscription_id: null, status: 'pending' } } }, 409],
    ['解約予約済み', { row: { data: { payjp_subscription_id: 'sub_1', status: 'canceled' } } }, 409],
  ])('%s → %s（PAY.JP を呼ばない）', async (_l, opts, status) => {
    db(opts as Opts);
    expect((await POST(postReq(BODY))).status).toBe(status);
    expect(mockCancel).not.toHaveBeenCalled();
  });
  test('PAY.JP の解約に失敗したら 500 で、状態を変えない', async () => {
    mockCancel.mockRejectedValue(new Error('down'));
    expect((await POST(postReq(BODY))).status).toBe(500);
    expect(mockDb.calls.some((c) => c.op === 'update')).toBe(false);
  });
  test('表示用の状態の更新に失敗したら 500（解約自体は受け付け済みと伝える）', async () => {
    db({ mark: { error: { message: 'x' } } });
    const res = await POST(postReq(BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('解約は受け付けました');
  });
});
