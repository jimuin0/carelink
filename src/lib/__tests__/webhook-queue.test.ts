/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/webhook-queue.ts
 * Key assertions:
 *   - scheduleRetry: DB failure on mark-as-failed logs error (job remains
 *     visible instead of silently stuck in 'processing' state)
 *   - scheduleRetry: DB failure on reschedule logs error
 *   - scheduleRetry: 戻り値で dead-letter / rescheduled を区別する
 *   - scheduleRetry: pending 復帰時に claimed_at をクリアする
 *   - enqueueWebhook: never throws (fire-and-forget; errors are swallowed)
 *   - enqueueWebhook: insert の { error } を可視化する（無音ロスト防止・target_id はマスク）
 */

const mockFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

jest.mock('@/lib/alert', () => ({
  alertWarning: jest.fn(),
}));

import { enqueueWebhook, scheduleRetry } from '../webhook-queue';
import { alertWarning } from '../alert';

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
    insert: jest.fn(() => Promise.resolve({ error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

// ─── enqueueWebhook ───────────────────────────────────────────────────────────

test('enqueueWebhook: DB insert成功 → resolves without throw', async () => {
  mockFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });
  await expect(enqueueWebhook({
    type: 'line_push',
    targetId: 'U12345',
    payload: { message: 'test' },
  })).resolves.toBeUndefined();
});

test('enqueueWebhook: DB insert失敗してもthrowしない（fire-and-forget）＋ catch経路もconsole.errorで可視化する', async () => {
  mockFrom.mockImplementation(() => { throw new Error('DB unreachable'); });
  await expect(enqueueWebhook({
    type: 'email',
    targetId: 'user@example.com',
    payload: {},
  })).resolves.toBeUndefined();
  // 旧実装は catch{} が完全に空でネットワーク例外等が無音化していた。
  // 可視化されていること・target_id がマスクされていることを確認する。
  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] enqueue threw',
    expect.objectContaining({ targetId: 'u***@example.com', err: 'DB unreachable' })
  );
});

test('enqueueWebhook: catchが非Error値をthrow → String(e)フォールバックでconsole.error', async () => {
  mockFrom.mockImplementation(() => { throw 'non-error-string'; });
  await enqueueWebhook({
    type: 'line_push',
    targetId: 'U12345',
    payload: {},
  });
  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] enqueue threw',
    expect.objectContaining({ err: 'non-error-string' })
  );
});

test('enqueueWebhook: insert が {error} を返す（メールtargetId）→ console.errorでマスクして可視化 + alertWarning発火', async () => {
  mockFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) });
  await enqueueWebhook({
    type: 'email',
    targetId: 'user@example.com',
    payload: { subject: 'secret subject' },
  });
  // insert() の戻り値 error は旧実装では完全に無視されていた（catch{} にも到達しない）ため、
  // キュー登録失敗＝通知の永久ロストが無音化していた。console.error で可視化し、
  // target_id はメールアドレスの可能性があるためマスクする（payload本文は出力しない）。
  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] enqueue failed — notification may be permanently lost',
    expect.objectContaining({ webhookType: 'email', targetId: 'u***@example.com' })
  );
  const call = (console.error as jest.Mock).mock.calls.find(
    (c) => c[0] === '[webhook-queue] enqueue failed — notification may be permanently lost'
  );
  expect(JSON.stringify(call[1])).not.toContain('secret subject');
  expect(alertWarning).toHaveBeenCalled();
});

test('enqueueWebhook: insert が {error} を返す（LINE user_idのtargetId・@なし）→ 先頭4文字のみ残しマスク', async () => {
  mockFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) });
  await enqueueWebhook({
    type: 'line_push',
    targetId: 'Uabcdefgh12345',
    payload: { message: 'hi' },
  });
  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] enqueue failed — notification may be permanently lost',
    expect.objectContaining({ webhookType: 'line_push', targetId: 'Uabc****' })
  );
});

test('enqueueWebhook: insert が {error} を返す・targetIdが4文字以下（@なし）→ 全マスク', async () => {
  mockFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) });
  await enqueueWebhook({
    type: 'line_push',
    targetId: 'U12',
    payload: {},
  });
  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] enqueue failed — notification may be permanently lost',
    expect.objectContaining({ targetId: '****' })
  );
});

// ─── scheduleRetry: max attempts exceeded ────────────────────────────────────

test('scheduleRetry: attempt>=3 → failed状態に更新し、戻り値は "dead-letter"', async () => {
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  const outcome = await scheduleRetry('job-abc', 3, 'LINE API error');

  expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  // route.ts はこの戻り値で「二度と自動再送されない」件数を数え、alertDeliveryFailures の
  // 文言を「dead-letter」向けに差し替える。'rescheduled' のままだと嘘の「再送します」表示になる。
  expect(outcome).toBe('dead-letter');
});

test('scheduleRetry: attempt>=3 のDB失敗 → エラーログを出力（ジョブがprocessingで止まらないよう）', async () => {
  mockFrom.mockReturnValue(updateChain({ message: 'update failed' }));

  await scheduleRetry('job-xyz', 3, 'timeout');

  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] failed to mark job as failed — job stuck in processing',
    expect.objectContaining({ jobId: 'job-xyz' })
  );
});

// ─── scheduleRetry: reschedule path ──────────────────────────────────────────

test('scheduleRetry: attempt=1（即時失敗）→ pending・attempt_count=1・5分後に再スケジュール・claimed_atをクリアし戻り値は"rescheduled"', async () => {
  const before = Date.now();
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  const outcome = await scheduleRetry('job-def', 1, 'temporary error');

  const called = updateMock.mock.calls[0][0];
  expect(called).toEqual(expect.objectContaining({
    status: 'pending',
    attempt_count: 1,
  }));
  // pending へ戻す行は「未 claim」に戻るため claimed_at を必ずクリアする。
  // 残したままだと stale reclaim が古い claim 時刻を見て誤判定しかねない。
  expect(called.claimed_at).toBeNull();
  // 完了1回 → RETRY_DELAYS_MS[1]=5分後（以前は死にコードだった5分層を回帰固定）
  const scheduledAt = new Date(called.scheduled_at).getTime();
  expect(scheduledAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
  expect(scheduledAt).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 1000);
  expect(outcome).toBe('rescheduled');
});

test('scheduleRetry: attempt=2（5分後失敗）→ attempt_count=2・scheduled_at が30分後', async () => {
  const before = Date.now();
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  const outcome = await scheduleRetry('job-ghi', 2, 'error');

  const called = updateMock.mock.calls[0][0];
  expect(called.attempt_count).toBe(2);
  const scheduledAt = new Date(called.scheduled_at).getTime();
  // 完了2回 → RETRY_DELAYS_MS[2]=30分後（give 1-second tolerance）
  expect(scheduledAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
  expect(scheduledAt).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 1000);
  expect(outcome).toBe('rescheduled');
});

test('scheduleRetry: 再スケジュールDB失敗 → エラーログを出力', async () => {
  mockFrom.mockReturnValue(updateChain({ message: 'reschedule failed' }));

  await scheduleRetry('job-stuck', 1, 'error message');

  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] failed to reschedule job — job stuck in processing',
    expect.objectContaining({ jobId: 'job-stuck', attempt: 1 })
  );
});
