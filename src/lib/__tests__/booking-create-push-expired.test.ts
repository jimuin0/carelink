/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * E19 の回帰テスト（実際の送信経路をそのまま通す）。
 *
 * 予約の Push 先の端末の購読が失効していて Push サービスが 410 を返したとき、以前は
 * sendPushToUser が false を返すだけで「届いたか分からない」と同じ扱いになり、行は
 * status='processing'・delivery_started_at 付きのまま残った。webhook-retry はこれを
 * 1 時間後から 15 分ごとに「結果不明の保留」としてエラー通報し続けた（運営が SQL で閉じるまで）。
 *
 * ここでは dispatch → 準備 → 送信フェンス → web-push（410）→ 後始末 を本物のモジュールで通し、
 * 「失敗として 1 回で閉じる・失効した購読だけを消す・保留にしない」を結果で確かめる。
 */
const OPERATION = 'c2000000-0000-4000-8000-000000000001';
const JOB_ID = 'c2000000-0000-4000-8000-000000000002';
const OWNER = 'c2000000-0000-4000-8000-000000000003';
const STARTED = '2030-01-01T00:00:01.000Z';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/expired-device', p256dh: 'synthetic-key', auth: 'synthetic-auth' };
const job = {
  id: JOB_ID, webhook_type: 'booking_creation_push', target_id: OWNER, attempt_count: 0, status: 'pending',
  payload: { title: '新規予約', body: 'Synthetic様から2030-01-07 10:00〜の予約が入りました', url: '/admin/bookings', tag: 'booking-x',
    dispatch_version: 2, booking_create_operation: OPERATION, booking_role: 'owner', booking_target_user: OWNER },
};
const mockState = {
  queueWrites: [] as Record<string, unknown>[],
  queueFilters: [] as Record<string, unknown>[],
  pushDeletes: [] as Record<string, unknown>[],
  closeConfirmed: true,
  // 送信フェンスの前に読んだ端末（null＝その時点では未登録）。
  subscription: SUB as typeof SUB | null,
  // 失効した端末の行がまだ残っているか（false＝送信の間に別の端末へ登録し直した／既に消えた）。
  expiredRowRemains: true,
};
const mockSendNotification = jest.fn();

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  generateRequestDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));
jest.mock('../alert', () => ({ alertWarning: jest.fn(), alertCaughtError: jest.fn(), alertError: jest.fn() }));
jest.mock('../safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('../supabase-server', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'push_subscriptions') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockState.subscription, error: null }) }) }),
          delete: () => {
            const filters: Record<string, unknown> = {};
            mockState.pushDeletes.push(filters);
            const chain: Record<string, unknown> = {
              eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
              select: () => ({
                then: (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(
                  { data: mockState.expiredRowRemains ? [{ id: 'expired-row' }] : [], error: null },
                ).then(done, fail),
              }),
            };
            return chain;
          },
        };
      }
      // webhook_retry_queue: 最初の select は対象ジョブの検索、update は結果の記録。
      let mutation: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'lte', 'is']) chain[name] = () => chain;
      chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain; };
      chain.update = (values: Record<string, unknown>) => { mutation = values; mockState.queueWrites.push(values); mockState.queueFilters.push(filters); return chain; };
      chain.then = (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(
        mutation ? { data: mockState.closeConfirmed ? [{ id: JOB_ID }] : [], error: null } : { data: [job], error: null },
      ).then(done, fail);
      return chain;
    },
    rpc: async (name: string) => (name === 'claim_webhook_retry_queue_v2'
      ? { data: [job], error: null }
      : { data: [{ outcome: 'ready', started_at: STARTED }], error: null }),
  }),
}));

process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'synthetic-public';
process.env.VAPID_PRIVATE_KEY = 'synthetic-private';

import { dispatchBookingCreationNotifications } from '../booking-create-dispatch';
import { alertWarning } from '../alert';

beforeEach(() => {
  jest.clearAllMocks();
  mockState.queueWrites.length = 0;
  mockState.queueFilters.length = 0;
  mockState.pushDeletes.length = 0;
  mockState.closeConfirmed = true;
  mockState.subscription = SUB;
  mockState.expiredRowRemains = true;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test.each([410, 404])('端末の購読が失効（%s）→ 失敗として 1 回で閉じ、失効した購読だけを消す（結果不明の保留にしない）', async (statusCode) => {
  mockSendNotification.mockRejectedValue({ statusCode });

  const result = await dispatchBookingCreationNotifications(OPERATION);

  expect(result).toEqual({ accepted: 0, pending: 0, uncertain: 0, skipped: 1 });
  expect(mockSendNotification).toHaveBeenCalledTimes(1);
  expect(mockState.queueWrites).toEqual([expect.objectContaining({ status: 'failed', last_error: 'booking_push_subscription_expired' })]);
  expect(mockState.queueFilters[0]).toEqual(expect.objectContaining({ id: JOB_ID, status: 'processing', delivery_started_at: STARTED }));
  expect(mockState.pushDeletes).toEqual([{ user_id: OWNER, endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: SUB.auth }]);
  expect(alertWarning).toHaveBeenCalledTimes(1);
});

test('Push サービスが受け取った → success として記録する', async () => {
  mockSendNotification.mockResolvedValue({ statusCode: 201 });
  expect(await dispatchBookingCreationNotifications(OPERATION)).toEqual({ accepted: 1, pending: 0, uncertain: 0, skipped: 0 });
  expect(mockState.queueWrites).toEqual([expect.objectContaining({ status: 'success' })]);
  expect(mockState.pushDeletes).toEqual([]);
});

test('応答が分からない（timeout・5xx）ものは従来どおり保留（受理済みかもしれないので再送しない）', async () => {
  mockSendNotification.mockRejectedValue({ statusCode: 503 });
  expect(await dispatchBookingCreationNotifications(OPERATION)).toEqual({ accepted: 0, pending: 0, uncertain: 1, skipped: 0 });
  expect(mockState.queueWrites).toEqual([]);
  expect(mockState.pushDeletes).toEqual([]);
});

// 送信フェンスは「その利用者に何かしらの端末があるか」しか見ず、ここで読んだ端末と同じかまでは確かめない。
// 読んでからフェンスまでの間に端末が変わったときは何も届いていないので、閉じず（＝dead-letter と Slack 警告を
// 出さず）通常の再試行に回し、次の試行で今の端末へ届ける（2026年10月23日 レビュー指摘）。
test('読んだ時点で端末が無かったのにフェンスが通った（直後に登録された）→ 送らずに再試行へ回す（閉じない）', async () => {
  mockState.subscription = null;
  expect(await dispatchBookingCreationNotifications(OPERATION)).toEqual({ accepted: 0, pending: 1, uncertain: 0, skipped: 0 });
  expect(mockSendNotification).not.toHaveBeenCalled();
  expect(mockState.queueWrites).toEqual([expect.objectContaining({ status: 'pending', delivery_started_at: null })]);
  expect(alertWarning).not.toHaveBeenCalled();
});

test('失効した端末の行がもう無い（送信の間に別の端末へ登録し直した）→ 「削除しました」と閉じず、再試行へ回す', async () => {
  mockSendNotification.mockRejectedValue({ statusCode: 410 });
  mockState.expiredRowRemains = false;
  expect(await dispatchBookingCreationNotifications(OPERATION)).toEqual({ accepted: 0, pending: 1, uncertain: 0, skipped: 0 });
  expect(mockState.queueWrites).toEqual([expect.objectContaining({ status: 'pending', delivery_started_at: null })]);
  expect(mockState.queueWrites).not.toContainEqual(expect.objectContaining({ status: 'failed' }));
  expect(alertWarning).not.toHaveBeenCalled();
});
