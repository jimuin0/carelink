/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { applyPayjpEvent, parsePayjpEvent, type PayjpWebhookEvent } from '../featured-ads-payjp';
import { FEATURED_AD_RENEWAL_GRACE_MS } from '../payjp';
import { createFakeSupabase, eqOf, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const SLOT = '11111111-1111-4111-8111-111111111111';
const FAC = '22222222-2222-4222-8222-222222222222';
const PERIOD_END = 1_800_000_000;
const CREATED = 1_799_000_000;

type Link = { slot_id: string; facility_id: string; payjp_subscription_id: string | null; last_event_at: string | null };
const baseLink: Link = { slot_id: SLOT, facility_id: FAC, payjp_subscription_id: 'sub_1', last_event_at: null };

function setup(opts: {
  byId?: FakeResult; bySlot?: FakeResult; slotUpdate?: FakeResult; linkUpdate?: FakeResult;
} = {}) {
  const fake = createFakeSupabase((call: FakeCall) => {
    if (call.table === 'featured_slot_payjp_subscriptions' && call.op === 'select') {
      return eqOf(call, 'payjp_subscription_id') !== undefined ? (opts.byId ?? { data: baseLink }) : (opts.bySlot ?? { data: null });
    }
    if (call.table === 'featured_slots') return opts.slotUpdate ?? { data: [{ id: SLOT }] };
    if (call.table === 'featured_slot_payjp_subscriptions' && call.op === 'update') return opts.linkUpdate ?? { data: [{ slot_id: SLOT }] };
    return undefined;
  });
  return fake;
}
const event = (type: string, data: Record<string, unknown> = {}, created = CREATED): PayjpWebhookEvent => ({
  id: 'evnt_1', type, created,
  data: { object: 'subscription', id: 'sub_1', status: 'active', current_period_end: PERIOD_END, metadata: { slot_id: SLOT, facility_id: FAC }, ...data },
});
const slotPayload = (fake: ReturnType<typeof setup>) => fake.calls.find((c) => c.table === 'featured_slots')!.payload as Record<string, unknown>;
const linkPayload = (fake: ReturnType<typeof setup>) => fake.calls.find((c) => c.table === 'featured_slot_payjp_subscriptions' && c.op === 'update')!.payload as Record<string, unknown>;

describe('parsePayjpEvent', () => {
  test('正しい形だけを受け付ける', () => {
    expect(parsePayjpEvent({ id: 'evnt_1', type: 'subscription.created', created: 1, data: {} })).toEqual({ id: 'evnt_1', type: 'subscription.created', created: 1, data: {} });
  });
  test.each([
    null, 'x', { type: 't', created: 1, data: {} }, { id: 'bad id', type: 't', created: 1, data: {} },
    { id: 'e', type: '', created: 1, data: {} }, { id: 'e', type: 'x'.repeat(101), created: 1, data: {} },
    { id: 'e', type: 't', created: 'x', data: {} }, { id: 'e', type: 't', created: Infinity, data: {} },
    { id: 'e', type: 't', created: 1, data: null }, { id: 'e', type: 't', created: 1, data: 'x' },
  ])('不正な形 %p は null', (v) => { expect(parsePayjpEvent(v)).toBeNull(); });
});

describe('applyPayjpEvent', () => {
  test.each(['subscription.created', 'subscription.renewed', 'subscription.resumed', 'subscription.updated'])('%s（active）で掲載し、期間末＋猶予まで延ばす', async (type) => {
    const fake = setup();
    await expect(applyPayjpEvent(fake.client as never, event(type))).resolves.toBe('applied');
    expect(slotPayload(fake)).toEqual({ is_active: true, ends_at: new Date(PERIOD_END * 1000 + FEATURED_AD_RENEWAL_GRACE_MS).toISOString() });
    expect(linkPayload(fake)).toMatchObject({ payjp_subscription_id: 'sub_1', status: 'active', current_period_end: new Date(PERIOD_END * 1000).toISOString(), last_event_at: new Date(CREATED * 1000).toISOString() });
  });

  test('trial はまだ課金されていないので掲載しない', async () => {
    const fake = setup();
    await applyPayjpEvent(fake.client as never, event('subscription.created', { status: 'trial' }));
    expect(slotPayload(fake)).toEqual({ is_active: false, ends_at: new Date(PERIOD_END * 1000).toISOString() });
    expect(linkPayload(fake).status).toBe('trial');
  });

  test('updated で status=canceled なら期間末まで掲載（猶予なし）', async () => {
    const fake = setup();
    await applyPayjpEvent(fake.client as never, event('subscription.updated', { status: 'canceled' }));
    expect(slotPayload(fake)).toEqual({ is_active: true, ends_at: new Date(PERIOD_END * 1000).toISOString() });
  });

  test('paused（更新時の課金失敗）で掲載を止める', async () => {
    const fake = setup();
    await applyPayjpEvent(fake.client as never, event('subscription.paused', { status: 'paused' }));
    expect(slotPayload(fake).is_active).toBe(false);
    expect(linkPayload(fake).status).toBe('paused');
  });

  test('canceled（期間末解約）は期間末まで掲載を続ける', async () => {
    const fake = setup();
    await applyPayjpEvent(fake.client as never, event('subscription.canceled', { status: 'canceled' }));
    expect(slotPayload(fake)).toEqual({ is_active: true, ends_at: new Date(PERIOD_END * 1000).toISOString() });
    expect(linkPayload(fake).status).toBe('canceled');
  });

  test('deleted（契約終了）で掲載を止め、期間をイベント時刻で閉じる', async () => {
    const fake = setup();
    await applyPayjpEvent(fake.client as never, event('subscription.deleted', { current_period_end: null }));
    expect(slotPayload(fake)).toEqual({ is_active: false, ends_at: new Date(CREATED * 1000).toISOString() });
    expect(linkPayload(fake)).toMatchObject({ status: 'deleted', current_period_end: null });
  });

  test('subscription 以外（charge.* 等）は何もしない', async () => {
    const fake = setup();
    await expect(applyPayjpEvent(fake.client as never, event('charge.succeeded'))).resolves.toBe('ignored');
    expect(fake.calls).toHaveLength(0);
  });

  test('知らない status は失敗（再送させて気づく）', async () => {
    await expect(applyPayjpEvent(setup().client as never, event('subscription.updated', { status: 'weird' }))).rejects.toThrow('unknown subscription status');
  });

  test.each([[{ object: 'charge' }], [{ id: 123 }]])('subscription の形でなければ失敗 %p', async (patch) => {
    await expect(applyPayjpEvent(setup().client as never, event('subscription.paused', patch))).rejects.toThrow('does not carry a subscription object');
  });

  test('ID の保存より先に届いたら metadata.slot_id で枠を見つける', async () => {
    const fake = setup({ byId: { data: null }, bySlot: { data: { ...baseLink, payjp_subscription_id: null } } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.created'))).resolves.toBe('applied');
    expect(eqOf(fake.calls[1], 'slot_id')).toBe(SLOT);
  });

  test('metadata.slot_id の枠が同じ定期課金に紐づいていても見つける', async () => {
    const fake = setup({ byId: { data: null }, bySlot: { data: baseLink } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.created'))).resolves.toBe('applied');
  });

  test('metadata.slot_id の枠が別の定期課金に紐づいていたら書き換えない', async () => {
    const fake = setup({ byId: { data: null }, bySlot: { data: { ...baseLink, payjp_subscription_id: 'sub_other' } } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.created'))).rejects.toThrow('no featured slot');
    expect(fake.calls.some((c) => c.table === 'featured_slots')).toBe(false);
  });

  test('枠が見つからなければ失敗（metadata なし）', async () => {
    const fake = setup({ byId: { data: null } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.created', { metadata: null }))).rejects.toThrow('no featured slot');
  });

  test('metadata.facility_id が枠と違えば失敗', async () => {
    const fake = setup();
    await expect(applyPayjpEvent(fake.client as never, event('subscription.created', { metadata: { facility_id: 'other' } }))).rejects.toThrow('does not match');
  });

  test('すでに新しいイベントを反映済みなら古いイベントで巻き戻さない', async () => {
    const fake = setup({ byId: { data: { ...baseLink, last_event_at: new Date((CREATED + 10) * 1000).toISOString() } } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.paused'))).resolves.toBe('stale');
    expect(fake.calls.some((c) => c.table === 'featured_slots')).toBe(false);
  });

  test('同時刻・より新しいイベントは反映する', async () => {
    const fake = setup({ byId: { data: { ...baseLink, last_event_at: new Date(CREATED * 1000).toISOString() } } });
    await expect(applyPayjpEvent(fake.client as never, event('subscription.renewed'))).resolves.toBe('applied');
  });

  test.each([
    [{ byId: { error: { message: 'db' } } }, 'lookup failed'],
    [{ byId: { data: null }, bySlot: { error: { message: 'db' } } }, 'lookup failed'],
    [{ slotUpdate: { error: { message: 'db' } } }, 'featured_slots update failed'],
    [{ slotUpdate: { data: [] } }, 'featured_slots update matched 0 rows'],
    [{ slotUpdate: { data: null } }, 'featured_slots update matched 0 rows'],
    [{ linkUpdate: { error: { message: 'db' } } }, 'featured_slot_payjp_subscriptions update failed'],
    [{ linkUpdate: { data: [] } }, 'featured_slot_payjp_subscriptions update matched 0 rows'],
    [{ linkUpdate: { data: null } }, 'featured_slot_payjp_subscriptions update matched 0 rows'],
  ])('DB の失敗は throw（webhook が 500 で再送させる） %#', async (opts, message) => {
    await expect(applyPayjpEvent(setup(opts as never).client as never, event('subscription.renewed'))).rejects.toThrow(message);
  });
});
