/** @jest-environment node */
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlert(...a) }));
const mockApply = jest.fn();
jest.mock('@/lib/featured-ads-payjp', () => ({
  ...jest.requireActual('@/lib/featured-ads-payjp'),
  applyPayjpEvent: (...a: unknown[]) => mockApply(...a),
}));
let mockDb: ReturnType<typeof import('@/test-utils/fake-supabase').createFakeSupabase>;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockDb.client }));

import { POST } from '../route';
import { createFakeSupabase, type FakeCall, type FakeResult } from '@/test-utils/fake-supabase';

const ENV = { ...process.env };
const TOKEN = 'whook_test_token';
const body = { id: 'evnt_abc', type: 'subscription.renewed', created: 1_800_000_000, object: 'event', data: { object: 'subscription', id: 'sub_1' } };

function db(opts: { seen?: FakeResult; insert?: FakeResult; done?: FakeResult } = {}) {
  mockDb = createFakeSupabase((call: FakeCall) => {
    if (call.table !== 'payjp_webhook_events') return undefined;
    if (call.op === 'select') return opts.seen ?? { data: null };
    if (call.op === 'upsert') return opts.insert;
    if (call.op === 'update' && (call.payload as { processed_at?: string }).processed_at) return opts.done;
    return undefined;
  });
}
const req = (payload: unknown = body, token: string | null = TOKEN) => new Request('http://localhost/api/payjp/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token === null ? {} : { 'x-payjp-webhook-token': token }) },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, PAYJP_SECRET_KEY: 'sk_test', PAYJP_WEBHOOK_TOKEN: TOKEN, NEXT_PUBLIC_PAYJP_PUBLIC_KEY: 'pk_test', PAYJP_FEATURED_PLAN_ID: 'pln_1' };
  mockApply.mockResolvedValue('applied');
  db();
});
afterAll(() => { process.env = ENV; });

test('トークン一致・初回のイベントを反映して処理済みにする', async () => {
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ received: true, outcome: 'applied' });
  expect(mockApply).toHaveBeenCalledWith(mockDb.client, expect.objectContaining({ id: 'evnt_abc', type: 'subscription.renewed' }));
  const upsert = mockDb.calls.find((c) => c.op === 'upsert')!;
  expect(upsert.payload).toEqual({ event_id: 'evnt_abc', event_type: 'subscription.renewed' });
  expect(upsert.options).toEqual({ onConflict: 'event_id', ignoreDuplicates: true });
  expect(mockDb.calls.some((c) => c.op === 'update' && (c.payload as { processed_at?: string }).processed_at)).toBe(true);
});

test.each([['不一致', 'whook_wrong_token'], ['欠落', null]])('トークン%sは 401・何も処理しない', async (_l, token) => {
  const res = await POST(req(body, token));
  expect(res.status).toBe(401);
  expect(mockDb.calls).toHaveLength(0);
  expect(mockApply).not.toHaveBeenCalled();
});

test('PAY.JP の設定が揃っていなければ 404', async () => {
  delete process.env.PAYJP_FEATURED_PLAN_ID;
  expect((await POST(req())).status).toBe(404);
  expect(mockApply).not.toHaveBeenCalled();
});

test.each([['JSON でない', 'not json'], ['形が違う', { id: 'evnt_x' }]])('本文が%sなら 400', async (_l, payload) => {
  expect((await POST(req(payload))).status).toBe(400);
  expect(mockApply).not.toHaveBeenCalled();
});

test('処理済みのイベント（再送・重複配信）は反映し直さない', async () => {
  db({ seen: { data: { processed_at: '2026-11-13T00:00:00Z' } } });
  const res = await POST(req());
  expect(await res.json()).toEqual({ received: true, skipped: true });
  expect(mockApply).not.toHaveBeenCalled();
});

test('記録済みだが未処理（前回失敗）のイベントは、記録を作り直さずに反映し直す', async () => {
  db({ seen: { data: { processed_at: null } } });
  expect((await POST(req())).status).toBe(200);
  expect(mockDb.calls.some((c) => c.op === 'upsert')).toBe(false);
  expect(mockApply).toHaveBeenCalledTimes(1);
});

test('反映に失敗したら 500・通知・処理済みにしない（PAY.JP が再送する）', async () => {
  mockApply.mockRejectedValue(new Error('featured_slots update failed'));
  const res = await POST(req());
  expect(res.status).toBe(500);
  expect(mockAlert).toHaveBeenCalledWith('payjp-webhook-handler', expect.any(Error), '/api/payjp/webhook');
  const errUpdate = mockDb.calls.find((c) => c.op === 'update')!;
  expect(errUpdate.payload).toEqual({ error: 'featured_slots update failed' });
  expect(mockDb.calls.some((c) => c.op === 'update' && (c.payload as { processed_at?: string }).processed_at)).toBe(false);
});

test('Error 以外が投げられても 500', async () => {
  mockApply.mockRejectedValue('boom');
  expect((await POST(req())).status).toBe(500);
  expect(mockDb.calls.find((c) => c.op === 'update')!.payload).toEqual({ error: 'unknown error' });
});

test.each([
  ['記録の読み取り', { seen: { error: { message: 'db' } } }, 'payjp-webhook-log-read'],
  ['記録の作成', { insert: { error: { message: 'db' } } }, 'payjp-webhook-log-insert'],
  ['処理済みの記録', { done: { error: { message: 'db' } } }, 'payjp-webhook-log-done'],
])('%sに失敗したら 500 で再送させる', async (_l, opts, tag) => {
  db(opts);
  expect((await POST(req())).status).toBe(500);
  expect(mockAlert).toHaveBeenCalledWith(tag, expect.anything(), '/api/payjp/webhook');
});
