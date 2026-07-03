/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/cron-heartbeat
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/cron-heartbeat', () => ({ getStaleCronJobs: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import { getStaleCronJobs } from '@/lib/cron-heartbeat';
import { GET } from '../route';

function makeRequest() {
  return new Request('http://localhost/api/cron/cron-heartbeat');
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
});

test('CRON_SECRET 不正 → 認証エラーを返し判定しない', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(new Response('unauthorized', { status: 401 }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
  expect(getStaleCronJobs).not.toHaveBeenCalled();
});

test('停止疑いなし・判定失敗なし → 200・アラート無し・success ログ', async () => {
  (getStaleCronJobs as jest.Mock).mockResolvedValue({ stale: [], queryErrors: [] });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.stale).toEqual([]);
  expect(alertWarning).not.toHaveBeenCalled();
  expect(logCronRun).toHaveBeenCalledWith('cron-heartbeat', 'success', expect.any(Date), expect.objectContaining({ processed: 0 }));
  // 自身を除外して判定していること
  expect(getStaleCronJobs).toHaveBeenCalledWith(expect.any(Number), { excludeName: 'cron-heartbeat' });
});

test('stale 0 だが queryErrors あり（DB障害）→ 判定失敗を通報（無音化しない）', async () => {
  (getStaleCronJobs as jest.Mock).mockResolvedValue({ stale: [], queryErrors: ['daily-summary: boom', 'flag-reviews: boom'] });
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  expect(alertWarning).toHaveBeenCalledTimes(1);
  const [msg, opts] = (alertWarning as jest.Mock).mock.calls[0];
  expect(msg).toContain('判定失敗 2件');
  expect(opts.extra.query_errors).toEqual(['daily-summary: boom', 'flag-reviews: boom']);
  expect(opts.extra).not.toHaveProperty('detail'); // stale 無しなので detail は付けない
  expect(opts.extra.stale_jobs).toEqual([]);
});

test('停止疑いあり（queryErrors あり）→ 集約アラート1本・query_errors 同梱', async () => {
  (getStaleCronJobs as jest.Mock).mockResolvedValue({
    stale: [
      { name: 'webhook-retry', label: 'Webhook再送', lastRunAt: '2026-07-02T00:00:00Z', ageMinutes: 200, thresholdMinutes: 60 },
      { name: 'flag-reviews', label: 'レビューフラグ', lastRunAt: '2026-07-01T00:00:00Z', ageMinutes: 300, thresholdMinutes: 150 },
    ],
    queryErrors: ['daily-summary: boom'],
  });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.stale).toEqual(['webhook-retry', 'flag-reviews']);
  expect(alertWarning).toHaveBeenCalledTimes(1);
  const [msg, opts] = (alertWarning as jest.Mock).mock.calls[0];
  expect(msg).toContain('2件');
  expect(opts.route).toBe('/api/cron/cron-heartbeat');
  expect(opts.extra.stale_jobs).toEqual(['webhook-retry', 'flag-reviews']);
  expect(opts.extra.query_errors).toEqual(['daily-summary: boom']);
  expect(logCronRun).toHaveBeenCalledWith('cron-heartbeat', 'success', expect.any(Date), expect.objectContaining({ processed: 2 }));
});

test('停止疑いあり（queryErrors 無し）→ extra に query_errors を含めない', async () => {
  (getStaleCronJobs as jest.Mock).mockResolvedValue({
    stale: [{ name: 'weekly-report', label: '週次レポート', lastRunAt: '2026-06-01T00:00:00Z', ageMinutes: 99999, thresholdMinutes: 20190 }],
    queryErrors: [],
  });
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  const [, opts] = (alertWarning as jest.Mock).mock.calls[0];
  expect(opts.extra).not.toHaveProperty('query_errors');
});

test('判定処理が例外 → 500・error ログ', async () => {
  (getStaleCronJobs as jest.Mock).mockRejectedValue(new Error('db down'));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith('cron-heartbeat', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'db down' }));
});

test('非 Error 例外でも 500（String 化）', async () => {
  (getStaleCronJobs as jest.Mock).mockRejectedValue('plain-string');
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith('cron-heartbeat', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'plain-string' }));
});
