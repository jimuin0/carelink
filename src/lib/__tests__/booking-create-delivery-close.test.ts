/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { SupabaseClient } from '@supabase/supabase-js';
import { closeUndeliverableBookingCreation, describeUndeliverableBookingCreation } from '../booking-create-delivery-close';

const JOB = { id: 'c1000000-0000-4000-8000-000000000001', attempt_count: 1 };
const CLAIMED = '2030-01-01T00:00:00.000Z';
const STARTED = '2030-01-01T00:00:01.000Z';

function db(result: unknown, throws = false) {
  const filters: Record<string, unknown> = {};
  let written: Record<string, unknown> | null = null;
  const chain: Record<string, unknown> = {};
  chain.eq = jest.fn((key: string, value: unknown) => { filters[key] = value; return chain; });
  chain.select = jest.fn(() => (throws ? Promise.reject(new Error('network')) : Promise.resolve(result)));
  const client = { from: jest.fn(() => ({ update: jest.fn((values: Record<string, unknown>) => { written = values; return chain; }) })) };
  return { client: client as unknown as SupabaseClient, filters, written: () => written };
}

test('閉じるのは自分が claim して送信開始を記録した行だけ（失敗として終了し、再送もしない）', async () => {
  const mock = db({ data: [{ id: JOB.id }], error: null });
  expect(await closeUndeliverableBookingCreation(mock.client, JOB, CLAIMED, STARTED,
    { reason: 'booking_push_subscription_expired', status: 410 })).toBe(true);
  expect(mock.filters).toEqual({ id: JOB.id, status: 'processing', claimed_at: CLAIMED, delivery_started_at: STARTED });
  expect(mock.written()).toEqual(expect.objectContaining({
    status: 'failed', attempt_count: 2, last_error: 'booking_push_subscription_expired', processed_at: expect.any(String),
  }));
  // pending に戻さない（＝再送しない）・送信開始の記録も消さない。
  expect(mock.written()).not.toHaveProperty('delivery_started_at');
  expect(mock.written()).not.toHaveProperty('scheduled_at');
});

test.each([
  ['書き込みエラー', { data: null, error: { code: '522' } }],
  ['他のワーカーが既に動かした（0 行）', { data: [], error: null }],
  ['応答が配列でない', { data: null, error: null }],
  ['別の行が返った', { data: [{ id: 'other' }], error: null }],
])('%s → 閉じたと扱わない（呼び出し側は結果不明として保留する）', async (_label, result) => {
  expect(await closeUndeliverableBookingCreation(db(result).client, JOB, CLAIMED, STARTED, { reason: 'x', status: 404 })).toBe(false);
});

test('通信の例外も投げずに false（catch 節の中から呼ばれるため）', async () => {
  await expect(closeUndeliverableBookingCreation(db(null, true).client, JOB, CLAIMED, STARTED, { reason: 'x', status: 404 })).resolves.toBe(false);
});

test.each([
  ['booking_creation_push', 'Push通知', '端末の購読が失効していたため、購読の登録を削除しました'],
  ['booking_creation_lineworks', 'LINE WORKS通知', 'チャンネルが見つかりませんでした'],
])('運営向けの説明は経路と理由を伝え、宛先は載せない（%s）', (type, channel, detail) => {
  const message = describeUndeliverableBookingCreation(type);
  expect(message).toBe(message.replace(/\d+件/, ''));
  expect(message).toContain(`新規予約の${channel}を終了しました`);
  expect(message).toContain(detail);
  expect(message).toContain('再送はしません');
});

test('cron が 1 run 分をまとめるときは件数を添える（1 件なら付けない）', () => {
  expect(describeUndeliverableBookingCreation('booking_creation_push', 3)).toContain('新規予約のPush通知 3件を終了しました');
  expect(describeUndeliverableBookingCreation('booking_creation_lineworks', 1)).toContain('新規予約のLINE WORKS通知を終了しました');
});
