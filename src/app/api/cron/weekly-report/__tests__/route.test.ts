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
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendWeeklyReportEmail } from '@/lib/email';
import { alertDeliveryFailures } from '@/lib/alert';
import { GET } from '../route';

const mockFrom = jest.fn();

function makeRequest() {
  return new Request('http://localhost/api/cron/weekly-report');
}

function chain(resolved: unknown) {
  const p = Promise.resolve(resolved);
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, gte: () => obj, lte: () => obj, in: () => obj, limit: () => obj,
    insert: () => obj, delete: () => obj,
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
  claimError?: { code?: string; message?: string } | null;
} = {}) {
  // 監査P2: facility_members/profiles/facility_profilesはバルク取得(配列)に変更済み。
  // 各テストの単一オブジェクト指定を配列1件（またはnull→空配列）に変換する。
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain(opts.rows ?? { data: [], error: null });
    if (table === 'facility_notification_settings') return chain({ data: 'optedOut' in opts ? opts.optedOut : [], error: opts.optedOutError ?? null });
    if (table === 'facility_members') {
      const owner = 'owner' in opts ? opts.owner : { user_id: 'u1' };
      return chain({ data: owner ? [{ facility_id: 'f-1', user_id: owner.user_id }] : [] });
    }
    if (table === 'profiles') {
      const prof = 'prof' in opts ? opts.prof : { email: 'owner@example.com' };
      return chain({ data: prof ? [{ id: 'u1', email: prof.email ?? null }] : [] });
    }
    if (table === 'facility_profiles') {
      const fac = 'fac' in opts ? opts.fac : { name: 'テスト施設' };
      return chain({ data: fac ? [{ id: 'f-1', name: fac.name ?? null }] : [] });
    }
    // M-1: cron_report_sends の claim insert / release delete。既定は claim 成功（error:null）。
    if (table === 'cron_report_sends') return chain({ error: opts.claimError ?? null });
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

test('M-1: 二重発火で claim が 23505 → その run は送信しない（冪等・emailsSkippedにも計上しない）', async () => {
  setupFrom({
    rows: { data: [{ facility_id: 'f-1', total_revenue: 100, booking_count: 1 }], error: null },
    claimError: { code: '23505', message: 'duplicate key' },
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(json.emailsSkipped).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('M-1: claim insert が 23505 以外の error → 送信せずerrorログ＋alertDeliveryFailuresへ計上（監査: 従来は無音で送達失敗率が見えなかった）', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  setupFrom({
    rows: { data: [{ facility_id: 'f-1', total_revenue: 100, booking_count: 1 }], error: null },
    claimError: { code: '55000', message: 'other db error' },
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
  expect(errSpy).toHaveBeenCalledWith(
    expect.stringContaining('[weekly-report] claim insert failed'),
    expect.any(Object),
  );
  expect(alertDeliveryFailures).toHaveBeenCalledWith('weekly-report', 1, expect.anything());
  errSpy.mockRestore();
});

test('M-1: 送信が false → claim を解放する（delete 呼び出し）', async () => {
  (sendWeeklyReportEmail as jest.Mock).mockResolvedValue(false);
  const deleteSpy = jest.fn(() => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }));
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100, booking_count: 1 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: [{ facility_id: 'f-1', user_id: 'u1' }] });
    if (table === 'profiles') return chain({ data: [{ id: 'u1', email: 'owner@example.com' }] });
    if (table === 'facility_profiles') return chain({ data: [{ id: 'f-1', name: 'テスト施設' }] });
    if (table === 'cron_report_sends') return { insert: () => Promise.resolve({ error: null }), delete: deleteSpy };
    return chain({ data: null });
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(deleteSpy).toHaveBeenCalled(); // claim 解放
});

test('M-1: 送信 false かつ claim 解放も失敗 → LOUD にログ（恒久欠落の可視化）', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  (sendWeeklyReportEmail as jest.Mock).mockResolvedValue(false);
  const relErr = { message: 'delete failed' };
  const deleteSpy = jest.fn(() => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: relErr }) }) }) }));
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100, booking_count: 1 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: [{ facility_id: 'f-1', user_id: 'u1' }] });
    if (table === 'profiles') return chain({ data: [{ id: 'u1', email: 'owner@example.com' }] });
    if (table === 'facility_profiles') return chain({ data: [{ id: 'f-1', name: 'テスト施設' }] });
    if (table === 'cron_report_sends') return { insert: () => Promise.resolve({ error: null }), delete: deleteSpy };
    return chain({ data: null });
  });
  await GET(makeRequest());
  expect(errSpy).toHaveBeenCalledWith(
    expect.stringContaining('[weekly-report] claim release failed'),
    expect.any(Object),
  );
  errSpy.mockRestore();
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

test('email_weekly_report=false の施設はスキップ（opt-out・emailsSkippedではなくoptedOutに計上・監査: 意図的除外と本来送るべきだったのに送れなかった件数を区別する）', async () => {
  setupFrom({
    rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null },
    optedOut: [{ facility_id: 'f-1' }],
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(json.emailsSkipped).toBe(0);
  expect(json.optedOut).toBe(1);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('オーナー不在 → スキップ（emailsSkippedに計上・監査: 従来は無音でカウント漏れだった）', async () => {
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null }, owner: null });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(json.emailsSkipped).toBe(1);
});

test('オーナーのメール未登録 → スキップ（emailsSkippedに計上）', async () => {
  setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null }, prof: { email: null } });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(json.emailsSkipped).toBe(1);
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

// 監査P2: バルク取得のnull data分岐・同一施設への重複owner行の網羅
test('facility_membersがdata:nullを返す → オーナーなし扱いでスキップ', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: null });
    if (table === 'profiles') return chain({ data: [{ id: 'u1', email: 'owner@example.com' }] });
    if (table === 'facility_profiles') return chain({ data: [{ id: 'f-1', name: 'テスト施設' }] });
    if (table === 'cron_report_sends') return chain({ error: null });
    return chain({ data: null });
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('facility_membersが同一施設に複数owner行を返す → 先頭のみ採用（重複スキップ）', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: [
      { facility_id: 'f-1', user_id: 'u1' },
      { facility_id: 'f-1', user_id: 'u2' },
    ] });
    if (table === 'profiles') return chain({ data: [{ id: 'u1', email: 'owner@example.com' }] });
    if (table === 'facility_profiles') return chain({ data: [{ id: 'f-1', name: 'テスト施設' }] });
    if (table === 'cron_report_sends') return chain({ error: null });
    return chain({ data: null });
  });
  await GET(makeRequest());
  expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner@example.com' }));
});

test('profilesがdata:nullを返す → メールアドレス不明でスキップ', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: [{ facility_id: 'f-1', user_id: 'u1' }] });
    if (table === 'profiles') return chain({ data: null });
    if (table === 'facility_profiles') return chain({ data: [{ id: 'f-1', name: 'テスト施設' }] });
    if (table === 'cron_report_sends') return chain({ error: null });
    return chain({ data: null });
  });
  const json = await (await GET(makeRequest())).json();
  expect(json.emailsSent).toBe(0);
  expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
});

test('facility_profilesがdata:nullを返す → 施設名は既定「施設」で送信', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain({ data: [{ facility_id: 'f-1', total_revenue: 100 }], error: null });
    if (table === 'facility_notification_settings') return chain({ data: [], error: null });
    if (table === 'facility_members') return chain({ data: [{ facility_id: 'f-1', user_id: 'u1' }] });
    if (table === 'profiles') return chain({ data: [{ id: 'u1', email: 'owner@example.com' }] });
    if (table === 'facility_profiles') return chain({ data: null });
    if (table === 'cron_report_sends') return chain({ error: null });
    return chain({ data: null });
  });
  await GET(makeRequest());
  expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '施設' }));
});
