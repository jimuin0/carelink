/**
 * @jest-environment node
 *
 * Tests for lib/cron-logger.ts
 * Covers: logCronRun, withCronLog
 */

const mockInsert = jest.fn().mockResolvedValue({});
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

import { logCronRun, withCronLog } from '../cron-logger';

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

  test('does not throw when DB insert fails (fire-and-forget)', async () => {
    mockInsert.mockRejectedValue(new Error('DB error'));
    await expect(logCronRun('test-job', 'success', new Date())).resolves.toBeUndefined();
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
