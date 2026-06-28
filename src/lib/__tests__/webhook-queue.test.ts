/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/webhook-queue.ts
 * Key assertions:
 *   - scheduleRetry: DB failure on mark-as-failed logs error (job remains
 *     visible instead of silently stuck in 'processing' state)
 *   - scheduleRetry: DB failure on reschedule logs error
 *   - enqueueWebhook: never throws (fire-and-forget; errors are swallowed)
 */

const mockFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

import { enqueueWebhook, scheduleRetry } from '../webhook-queue';

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

test('enqueueWebhook: DB insert失敗してもthrowしない（fire-and-forget）', async () => {
  mockFrom.mockImplementation(() => { throw new Error('DB unreachable'); });
  await expect(enqueueWebhook({
    type: 'email',
    targetId: 'user@example.com',
    payload: {},
  })).resolves.toBeUndefined();
});

// ─── scheduleRetry: max attempts exceeded ────────────────────────────────────

test('scheduleRetry: attempt>=3 → failed状態に更新', async () => {
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  await scheduleRetry('job-abc', 3, 'LINE API error');

  expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
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

test('scheduleRetry: attempt=1（即時失敗）→ pending・attempt_count=1・5分後に再スケジュール', async () => {
  const before = Date.now();
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  await scheduleRetry('job-def', 1, 'temporary error');

  const called = updateMock.mock.calls[0][0];
  expect(called).toEqual(expect.objectContaining({
    status: 'pending',
    attempt_count: 1,
  }));
  // 完了1回 → RETRY_DELAYS_MS[1]=5分後（以前は死にコードだった5分層を回帰固定）
  const scheduledAt = new Date(called.scheduled_at).getTime();
  expect(scheduledAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
  expect(scheduledAt).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 1000);
});

test('scheduleRetry: attempt=2（5分後失敗）→ attempt_count=2・scheduled_at が30分後', async () => {
  const before = Date.now();
  const updateMock = jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) });
  mockFrom.mockReturnValue({ update: updateMock });

  await scheduleRetry('job-ghi', 2, 'error');

  const called = updateMock.mock.calls[0][0];
  expect(called.attempt_count).toBe(2);
  const scheduledAt = new Date(called.scheduled_at).getTime();
  // 完了2回 → RETRY_DELAYS_MS[2]=30分後（give 1-second tolerance）
  expect(scheduledAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
  expect(scheduledAt).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 1000);
});

test('scheduleRetry: 再スケジュールDB失敗 → エラーログを出力', async () => {
  mockFrom.mockReturnValue(updateChain({ message: 'reschedule failed' }));

  await scheduleRetry('job-stuck', 1, 'error message');

  expect(console.error).toHaveBeenCalledWith(
    '[webhook-queue] failed to reschedule job — job stuck in processing',
    expect.objectContaining({ jobId: 'job-stuck', attempt: 1 })
  );
});
