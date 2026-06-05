/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/watchdog（全 cron の未発火/失敗継続を能動監視）
 */
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/alert', () => ({ alertError: jest.fn(), alertWarning: jest.fn() }));
jest.mock('@/lib/supabase-server');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertError, alertWarning } from '@/lib/alert';
import { GET } from '../route';

// job_name → maybeSingle が返す {data, error}
let logsByJob: Record<string, { data: unknown; error: unknown }>;
let defaultLog: { data: unknown; error: unknown };
let maybeSingleImpl: ((job: string | null) => Promise<{ data: unknown; error: unknown }>) | null;

function installMock() {
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: (table: string) => {
      if (table !== 'cron_logs') return {};
      let capturedJob: string | null = null;
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn((col: string, val: string) => { if (col === 'job_name') capturedJob = val; return chain; }),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        maybeSingle: jest.fn(() => {
          if (maybeSingleImpl) return maybeSingleImpl(capturedJob);
          return Promise.resolve(logsByJob[capturedJob as string] ?? defaultLog);
        }),
      };
      return chain;
    },
  });
}

function makeRequest() {
  return new Request('http://localhost/api/cron/watchdog', {
    method: 'GET',
    headers: { authorization: 'Bearer cron-secret' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  logsByJob = {};
  // 既定は全 cron が直近成功（overdue なし）
  defaultLog = { data: { started_at: new Date().toISOString() }, error: null };
  maybeSingleImpl = null;
  installMock();
});

test('auth 失敗 → 認証エラーをそのまま返す', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(401);
});

test('全 cron が直近成功 → overdue 空・alertWarning 呼ばれない', async () => {
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.overdue).toEqual([]);
  expect(json.checked).toBeGreaterThan(0);
  expect(alertWarning).not.toHaveBeenCalled();
});

test('成功記録が無い cron → overdue（ageHours=null）・alertWarning 通知', async () => {
  logsByJob = { 'flag-reviews': { data: null, error: null } };
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(200);
  const json = await res.json();
  const entry = json.overdue.find((o: any) => o.job === 'flag-reviews');
  expect(entry).toBeDefined();
  expect(entry.lastSuccess).toBeNull();
  expect(entry.ageHours).toBeNull();
  expect(alertWarning).toHaveBeenCalled();
});

test('最終成功が古い cron → overdue（ageHours 数値）・alertWarning 通知', async () => {
  logsByJob = { 'webhook-retry': { data: { started_at: '2020-01-01T00:00:00Z' }, error: null } };
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(200);
  const json = await res.json();
  const entry = json.overdue.find((o: any) => o.job === 'webhook-retry');
  expect(entry).toBeDefined();
  expect(entry.lastSuccess).toBe('2020-01-01T00:00:00Z');
  expect(typeof entry.ageHours).toBe('number');
  expect(alertWarning).toHaveBeenCalled();
});

test('cron_logs 参照が error → alertError＋500', async () => {
  logsByJob = { 'booking-reminder': { data: null, error: { message: 'db down' } } };
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(500);
  expect(alertError).toHaveBeenCalled();
  expect(logCronRun).toHaveBeenCalledWith('watchdog', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'db down' }));
});

test('予期せぬ例外（maybeSingle が Error を throw）→ alertError＋500', async () => {
  maybeSingleImpl = () => Promise.reject(new Error('boom'));
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(500);
  expect(alertError).toHaveBeenCalled();
  expect(logCronRun).toHaveBeenCalledWith('watchdog', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'boom' }));
});

test('非 Error を throw → String フォールバックで 500', async () => {
  maybeSingleImpl = () => Promise.reject('string-boom');
  const res = await GET(makeRequest() as any);
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith('watchdog', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'string-boom' }));
});
