/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/weekly-report
 * - CRON_SECRET 認証
 * - daily_revenue_summary を期間合算し email_weekly_report=false 以外の施設へ送信
 * - 取得エラー→500 / 例外→500 / opt-out・オーナー不在・メール未登録はスキップ
 */
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email', () => ({ sendWeeklyReportEmail: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendWeeklyReportEmail } from '@/lib/email';
import { GET } from '../route';

const mockFrom = jest.fn();

function makeRequest() {
  return new Request('http://localhost/api/cron/weekly-report');
}

function chain(resolved: unknown) {
  const p = Promise.resolve(resolved);
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, gte: () => obj, lte: () => obj, in: () => obj, limit: () => obj,
    maybeSingle: () => Promise.resolve(resolved),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  };
  return obj;
}

function setupFrom(opts: {
  rows?: { data: Array<Record<string, number | string | null>> | null; error?: { message: string } | null };
  optedOut?: { facility_id: string }[] | null;
  optedOutError?: { message: string } | null;
  owner?: { user_id: string } | null;
  prof?: { email?: string | null } | null;
  fac?: { name?: string } | null;
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain(opts.rows ?? { data: [], error: null });
    if (table === 'facility_notification_settings') return chain({ data: 'optedOut' in opts ? opts.optedOut : [], error: opts.optedOutError ?? null });
    if (table === 'facility_members') return chain({ data: 'owner' in opts ? opts.owner : { user_id: 'u1' } });
    if (table === 'profiles') return chain({ data: 'prof' in opts ? opts.prof : { email: 'owner@example.com' } });
    if (table === 'facility_profiles') return chain({ data: 'fac' in opts ? opts.fac : { name: 'テスト施設' } });
    return chain({ data: null });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (createServiceRoleClient as jest.Mock).mockReturnValue({ from: mockFrom });
  (sendWeeklyReportEmail as jest.Mock).mockResolvedValue(true);
  setupFrom();
});

test('CRON_SECRET 不正 → 401', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(new Response('unauthorized', { status: 401 }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('daily_revenue_summary 取得エラー → 500', async () => {
  setupFrom({ rows: { data: null, error: { message: 'boom' } } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(), expect.objectContaining({ error_msg: 'boom' }));
});

test('対象データ無し → emailsSent 0', async () => {
  setupFrom({ rows: { data: [], error: null } });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('施設ごとに7日分を合算して送信（複数行の集約・emailsSent 計上）', async () => {
  setupFrom({
    rows: { data: [
      { facility_id: 'f-1', total_revenue: 100, booking_count: 1, completed_count: 1, cancelled_count: 0, new_customer_count: 1, repeat_customer_count: 0 },
      { facility_id: 'f-1', total_revenue: 200, booking_count: 2, completed_count: 2, cancelled_count: 1, new_customer_count: 0, repeat_customer_count: 1 },
    ], error: null },
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(1);
  expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({
    facilityEmail: 'owner@example.com', facilityName: 'テスト施設',
    totalRevenue: 300, bookingCount: 3, cancelledCount: 1, newCustomerCount: 1, repeatCustomerCount: 1,
  }));
});

test('数値列が null でも 0 に合算し施設名も既定で送る', async () => {
  setupFrom({
    rows: { data: [
      { facility_id: 'f-1', total_revenue: null, booking_count: null, completed_count: null, cancelled_count: null, new_customer_count: null, repeat_customer_count: null },
    ], error: null },
    fac: null,
  });
  await GET(makeRequest());
  expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({ totalRevenue: 0, bookingCount: 0, facilityName: '施設' }));
});

test('email_weekly_report=false の施設はスキップ（opt-out）', async () => {
  setupFrom({
    rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null },
    optedOut: [{ facility_id: 'f-1' }],
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('オーナー不在 → スキップ', async () => {
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null }, owner: null });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
});

test('オーナーのメール未登録 → スキップ', async () => {
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null }, prof: { email: null } });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
});

test('メール送信が false → emailsSent に計上しない', async () => {
  (sendWeeklyReportEmail as jest.Mock).mockResolvedValue(false);
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null } });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).toHaveBeenCalled();
});

test('rows が null（エラー無し）→ emailsSent 0', async () => {
  setupFrom({ rows: { data: null, error: null } });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('opt-out 取得が null でも送信は継続する（?? [] フォールバック）', async () => {
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null }, optedOut: null });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(1);
});

test('opt-out 一覧の取得エラー → fail-closed で 500（OFF 施設への誤送信を防ぐ）', async () => {
  setupFrom({
    rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null },
    optedOutError: { message: 'settings boom' },
  });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  // opt-out を確定できないので 1 通も送らない（fail-open な誤送信を防ぐ）
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
  expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(), expect.objectContaining({ error_msg: expect.stringContaining('settings boom') }));
});

test('予期しない例外 → 500', async () => {
  mockFrom.mockImplementation(() => { throw new Error('db down'); });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
});

test('非Error の例外でも 500（error_msg は String 化）', async () => {
  mockFrom.mockImplementation(() => { throw 'string-error'; });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(), expect.objectContaining({ error_msg: 'string-error' }));
});
