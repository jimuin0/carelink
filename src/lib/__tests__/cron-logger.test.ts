/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/cron-logger.ts
 * Covers: logCronRun, withCronLog
 */

const mockInsert = jest.fn().mockResolvedValue({});
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

// cron 失敗時の Slack 通報を検証するため alert をモック化（実投稿させない）
jest.mock('../alert', () => ({
  alertCaughtError: jest.fn(),
}));

import { logCronRun, withCronLog } from '../cron-logger';
import { alertCaughtError } from '../alert';

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({});
});

describe('logCronRun', () => {
  test('inserts success log with all fields', async () => {
    const startedAt = new Date('2026-04-01T10:00:00.000Z');
    await logCronRun('booking-reminder', 'success', startedAt, { processed: 5, skipped: 2 });
    expect(mockFrom).toHaveBeenCalledWith('cron_logs');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'booking-reminder',
      status: 'success',
      processed: 5,
      skipped: 2,
    }));
  });

  test('uses defaults for missing result fields', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'skipped', startedAt);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      processed: 0,
      skipped: 0,
      error_msg: null,
      meta: null,
    }));
  });

  test('inserts error log with error_msg', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'error', startedAt, { error_msg: 'Something went wrong' });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      error_msg: 'Something went wrong',
    }));
  });

  test('error → Slack alert (alertCaughtError) を発火する', async () => {
    await logCronRun('test-job', 'error', new Date(), { error_msg: 'boom' });
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
    const [tag, err, route] = (alertCaughtError as jest.Mock).mock.calls[0];
    expect(tag).toBe('cron:test-job');
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    expect(route).toBe('/api/cron/test-job');
  });

  test('error_msg 未指定 → unknown error で通報する', async () => {
    await logCronRun('test-job', 'error', new Date());
    const [, err] = (alertCaughtError as jest.Mock).mock.calls[0];
    expect((err as Error).message).toBe('unknown error');
  });

  test('success → Slack alert を発火しない（誤通報防止）', async () => {
    await logCronRun('test-job', 'success', new Date(), { processed: 1 });
    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('skipped → Slack alert を発火しない', async () => {
    await logCronRun('test-job', 'skipped', new Date());
    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('DB insert 失敗時でも error は通報する（記録失敗こそ通報必要）', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await logCronRun('test-job', 'error', new Date(), { error_msg: 'x' });
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
  });

  test('does not throw when DB insert fails (fire-and-forget)', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await expect(logCronRun('test-job', 'success', new Date())).resolves.toBeUndefined();
  });

  // C-5 根治: insert() は例外を投げず戻り値の { error } にDBレベル失敗を格納する
  // （RLS拒否・制約違反等）。この戻り値を無視すると catch{} に到達せず insert 失敗が
  // 完全に不可視化される（実際に「配信は成功したのに cron_logs にログが無い」と
  // 誤解される事案があった）。console.error で可視化されることを検証する。
  test('DB insert が戻り値の error を返す(reject しない)場合も console.error で可視化する', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockInsert.mockResolvedValue({ error: { message: 'RLS violation' } });
    await logCronRun('test-job', 'success', new Date());
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cron-logger] cron_logs insert failed — this run will be invisible in monitoring',
      expect.objectContaining({ jobName: 'test-job', status: 'success' }),
    );
    consoleSpy.mockRestore();
  });

  test('例外(reject)時も console.error で可視化する', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockInsert.mockRejectedValue(new Error('network down'));
    await logCronRun('test-job', 'success', new Date());
    expect(consoleSpy).toHaveBeenCalledWith(
      '[cron-logger] cron_logs insert threw',
      expect.objectContaining({ jobName: 'test-job', status: 'success' }),
    );
    consoleSpy.mockRestore();
  });

  test('includes meta when provided', async () => {
    const startedAt = new Date();
    await logCronRun('test-job', 'success', startedAt, { meta: { count: 10, source: 'api' } });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      meta: { count: 10, source: 'api' },
    }));
  });
});

describe('withCronLog', () => {
  test('success: calls fn, logs success, returns result with _logged', async () => {
    const fn = jest.fn().mockResolvedValue({ processed: 3, skipped: 1 });
    const result = await withCronLog('my-job', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result._logged).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'my-job',
      status: 'success',
    }));
  });

  test('error: catches fn error, logs error, re-throws', async () => {
    const err = new Error('Job failed');
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withCronLog('failing-job', fn)).rejects.toThrow('Job failed');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: 'failing-job',
      status: 'error',
      error_msg: 'Job failed',
    }));
  });

  test('error: non-Error thrown → logs string representation', async () => {
    const fn = jest.fn().mockRejectedValue('string error');
    await expect(withCronLog('test-job', fn)).rejects.toBe('string error');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      error_msg: 'string error',
    }));
  });
});
