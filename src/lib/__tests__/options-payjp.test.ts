/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockPayjp = { retrievePlan: jest.fn(), createPlan: jest.fn() };
jest.mock('../payjp', () => ({
  ...jest.requireActual('../payjp'),
  retrievePlan: (...a: unknown[]) => mockPayjp.retrievePlan(...a),
  createPlan: (...a: unknown[]) => mockPayjp.createPlan(...a),
}));
import { applyOptionSubscription, ensureOptionPlan, optionPlanId } from '../options-payjp';
import { PayjpError } from '../payjp';
import { createFakeSupabase, eqOf, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const admin = (db: ReturnType<typeof createFakeSupabase>) => db.client as never;
const LINK = { facility_id: 'f1', option_key: 'reminder_line', payjp_subscription_id: 'sub_1', last_event_at: null };

beforeEach(() => { mockPayjp.retrievePlan.mockReset(); mockPayjp.createPlan.mockReset(); });

describe('ensureOptionPlan', () => {
  const plan = (amount = 1500) => ({ id: 'carelink_option_reminder_line_1500', amount, currency: 'jpy', interval: 'month' });
  test('プラン ID はオプションと金額で決まる', () => {
    expect(optionPlanId('reminder_line', 1500)).toBe('carelink_option_reminder_line_1500');
  });
  test('既存のプランを使う', async () => {
    mockPayjp.retrievePlan.mockResolvedValue(plan());
    await expect(ensureOptionPlan('reminder_line', 1500, 'LINE')).resolves.toMatchObject({ amount: 1500 });
    expect(mockPayjp.createPlan).not.toHaveBeenCalled();
  });
  test('無ければ作る（名前は 64 文字まで）', async () => {
    mockPayjp.retrievePlan.mockRejectedValue(new PayjpError('nf', 404));
    mockPayjp.createPlan.mockResolvedValue(plan());
    await ensureOptionPlan('reminder_line', 1500, 'あ'.repeat(100));
    expect(mockPayjp.createPlan).toHaveBeenCalledWith('carelink_option_reminder_line_1500', 1500, expect.any(String));
    expect((mockPayjp.createPlan.mock.calls[0][2] as string).length).toBe(64);
  });
  test('404 以外の失敗は throw', async () => {
    mockPayjp.retrievePlan.mockRejectedValue(new PayjpError('down', 500));
    await expect(ensureOptionPlan('reminder_line', 1500, 'LINE')).rejects.toThrow('down');
  });
  test.each([[{ amount: 999 }], [{ currency: 'usd' }], [{ interval: 'year' }]])('値段・通貨・周期が食い違えば throw %o', async (diff) => {
    mockPayjp.retrievePlan.mockResolvedValue({ ...plan(), ...diff });
    await expect(ensureOptionPlan('reminder_line', 1500, 'LINE')).rejects.toThrow(/expected 1500 jpy\/month/);
  });
});

describe('applyOptionSubscription', () => {
  function make(opts: Partial<Record<'byId' | 'byKey' | 'ent' | 'upd', FakeResult>> = {}) {
    return createFakeSupabase((c: FakeCall) => {
      if (c.table === 'facility_entitlements') return opts.ent;
      if (c.op === 'update') return opts.upd ?? { data: [{ facility_id: 'f1' }] };
      if (eqOf(c, 'payjp_subscription_id') !== undefined) return opts.byId ?? { data: LINK };
      return opts.byKey ?? { data: null };
    });
  }
  const at = new Date('2026-11-14T00:00:00Z');
  const sub = (extra: Record<string, unknown> = {}) => ({ id: 'sub_1', status: 'active', current_period_end: 1_800_000_000, ...extra });

  test('対象外のイベントは無視', async () => {
    const db = make();
    expect(await applyOptionSubscription(admin(db), 'charge.succeeded', sub(), at)).toBe('ignored');
    expect(db.calls).toHaveLength(0);
  });
  test('active は entitlement を active にし、期間末を写す', async () => {
    const db = make();
    expect(await applyOptionSubscription(admin(db), 'subscription.created', sub(), at)).toBe('applied');
    const ent = db.calls.find((c) => c.table === 'facility_entitlements')!;
    expect(ent.payload).toMatchObject({ facility_id: 'f1', option_key: 'reminder_line', status: 'active', current_period_end: new Date(1_800_000_000_000).toISOString() });
    expect(ent.options).toEqual({ onConflict: 'facility_id,option_key' });
    const upd = db.calls.find((c) => c.op === 'update')!;
    expect(upd.payload).toMatchObject({ payjp_subscription_id: 'sub_1', status: 'active', last_event_at: at.toISOString() });
  });
  test('paused・deleted は entitlement を canceled にする（期間末が無ければ null）', async () => {
    const db = make();
    await applyOptionSubscription(admin(db), 'subscription.paused', sub({ current_period_end: null }), at);
    expect(db.calls.find((c) => c.table === 'facility_entitlements')!.payload).toMatchObject({ status: 'canceled', current_period_end: null });
  });
  test('ID の保存より先に届いた webhook は metadata で行を探す', async () => {
    const db = make({ byId: { data: null }, byKey: { data: { ...LINK, payjp_subscription_id: null } } });
    expect(await applyOptionSubscription(admin(db), 'subscription.created', sub({ metadata: { facility_id: 'f1', option_key: 'reminder_line' } }), at)).toBe('applied');
    const same = make({ byId: { data: null }, byKey: { data: LINK } });
    expect(await applyOptionSubscription(admin(same), 'subscription.created', sub({ metadata: { facility_id: 'f1', option_key: 'reminder_line' } }), at)).toBe('applied');
  });
  test('別の定期課金に紐づいた行・metadata の無いもの・見つからないものは throw', async () => {
    const other = make({ byId: { data: null }, byKey: { data: { ...LINK, payjp_subscription_id: 'sub_other' } } });
    await expect(applyOptionSubscription(admin(other), 'subscription.created', sub({ metadata: { facility_id: 'f1', option_key: 'reminder_line' } }), at)).rejects.toThrow(/no option subscription row/);
    await expect(applyOptionSubscription(admin(make({ byId: { data: null } })), 'subscription.created', sub({ metadata: 'x' }), at)).rejects.toThrow(/no option subscription row/);
    await expect(applyOptionSubscription(admin(make({ byId: { data: null } })), 'subscription.created', sub({ metadata: { facility_id: 'f1' } }), at)).rejects.toThrow(/no option subscription row/);
  });
  test('古いイベントは反映しない', async () => {
    const db = make({ byId: { data: { ...LINK, last_event_at: '2026-12-01T00:00:00Z' } } });
    expect(await applyOptionSubscription(admin(db), 'subscription.renewed', sub(), at)).toBe('stale');
    const newer = make({ byId: { data: { ...LINK, last_event_at: '2026-11-01T00:00:00Z' } } });
    expect(await applyOptionSubscription(admin(newer), 'subscription.renewed', sub(), at)).toBe('applied');
  });
  test.each([
    ['ID での読み取り', { byId: { error: { message: 'x' } } }, /lookup failed/],
    ['metadata での読み取り', { byId: { data: null }, byKey: { error: { message: 'x' } } }, /lookup failed/],
    ['entitlement の更新', { ent: { error: { message: 'x' } } }, /facility_entitlements upsert failed/],
    ['行の更新', { upd: { error: { message: 'x' } } }, /update failed/],
    ['行が 0 件', { upd: { data: [] } }, /matched 0 rows/],
    ['行が null', { upd: { data: null } }, /matched 0 rows/],
  ])('%sの失敗は throw', async (_l, opts, re) => {
    await expect(applyOptionSubscription(admin(make(opts as never)), 'subscription.created', sub({ metadata: { facility_id: 'f1', option_key: 'reminder_line' } }), at)).rejects.toThrow(re);
  });
});
