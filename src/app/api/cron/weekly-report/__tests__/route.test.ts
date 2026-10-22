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
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn().mockResolvedValue(undefined);
  const cronError = jest.fn(async (
    jobName: string,
    startedAt: Date,
    cause: unknown,
    opts: { message?: string; extraLog?: Record<string, unknown>; extraBody?: Record<string, unknown> } = {},
  ) => {
    const error_msg = cause instanceof Error
      ? cause.message
      : (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as any).message === 'string')
        ? (cause as any).message
        : String(cause);
    await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
    return {
      status: 500,
      json: async () => ({ error: opts.message ?? 'Internal error', ...opts.extraBody }),
    };
  });
  return { logCronRun, cronError };
});
jest.mock('@/lib/email', () => ({ sendWeeklyReportEmail: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendWeeklyReportEmail } from '@/lib/email';
import { alertDeliveryFailures } from '@/lib/alert';
import { GET } from '../route';

const mockFrom = jest.fn();
// aggregate_daily_revenue（集計し直し）の RPC。既定は成功。
const mockRpc = jest.fn();

function makeRequest() {
  return new Request('http://localhost/api/cron/weekly-report');
}

function chain(resolved: unknown) {
  const p = Promise.resolve(resolved);
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, gte: () => obj, lte: () => obj, in: () => obj, limit: () => obj, range: () => obj, order: () => obj,
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
  ownerError?: { message: string };
  prof?: { email?: string | null } | null;
  profileError?: { message: string };
  fac?: { name?: string } | null;
  facilityError?: { message: string };
  claimError?: { code?: string; message?: string } | null;
} = {}) {
  // 監査P2: facility_members/profiles/facility_profilesはバルク取得(配列)に変更済み。
  // 各テストの単一オブジェクト指定を配列1件（またはnull→空配列）に変換する。
  mockFrom.mockImplementation((table: string) => {
    if (table === 'daily_revenue_summary') return chain(opts.rows ?? { data: [], error: null });
    if (table === 'facility_notification_settings') return chain({ data: 'optedOut' in opts ? opts.optedOut : [], error: opts.optedOutError ?? null });
    if (table === 'facility_members') {
      const owner = 'owner' in opts ? opts.owner : { user_id: 'u1' };
      return chain({ data: owner ? [{ facility_id: 'f-1', user_id: owner.user_id }] : [], error: opts.ownerError });
    }
    if (table === 'profiles') {
      const prof = 'prof' in opts ? opts.prof : { email: 'owner@example.com' };
      return chain({ data: prof ? [{ id: 'u1', email: prof.email ?? null }] : [], error: opts.profileError });
    }
    if (table === 'facility_profiles') {
      const fac = 'fac' in opts ? opts.fac : { name: 'テスト施設' };
      return chain({ data: fac ? [{ id: 'f-1', name: fac.name ?? null }] : [], error: opts.facilityError });
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
  (createServiceRoleClient as jest.Mock).mockReturnValue({ from: mockFrom, rpc: mockRpc });
  mockRpc.mockResolvedValue({ data: 1, error: null });
  (sendWeeklyReportEmail as jest.Mock).mockResolvedValue(true);
  setupFrom();
});

afterEach(() => {
  jest.useRealTimers();
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

test.each(['ownerError', 'profileError', 'facilityError'] as const)(
  '%sは部分dataがあっても送信/claim前に停止し、正常skipとしない', async (errorField) => {
    setupFrom({ rows: { data: [{ facility_id: 'f-1', booking_count: 1 }], error: null },
      [errorField]: { message: 'recipient dependency unavailable' } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
    expect(mockFrom.mock.calls.some(([table]) => table === 'cron_report_sends')).toBe(false);
    expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(),
      expect.objectContaining({ error_msg: 'recipient dependency unavailable' }));
    expect(logCronRun).not.toHaveBeenCalledWith('weekly-report', 'success', expect.anything(), expect.anything());
  },
);

function pagedOverride(table: string, page: (offset: number) => unknown) {
  const delegate = mockFrom.getMockImplementation()!;
  mockFrom.mockImplementation((name: string) => {
    if (name !== table) return delegate(name);
    const query = chain({ data: [], error: null });
    query.range = (offset: number) => chain(page(offset));
    return query;
  });
}

test('集計1000件を越えた次ページも含めて送信する', async () => {
  setupFrom();
  pagedOverride('daily_revenue_summary', (offset) => ({ data: offset === 0
    ? Array.from({ length: 1000 }, (_, i) => ({ facility_id: `other-${i}`, booking_count: 1 }))
    : [{ facility_id: 'f-1', booking_count: 7, total_revenue: 700 }], error: null }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  expect(sendWeeklyReportEmail).toHaveBeenCalledTimes(1);
  expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({ bookingCount: 7, totalRevenue: 700 }));
});

test.each(['daily_revenue_summary', 'facility_members', 'profiles', 'facility_profiles'])(
  '%sの後続ページ障害では取得済み部分集合から送信しない', async (table) => {
    setupFrom({ rows: { data: [{ facility_id: 'f-1', booking_count: 1 }], error: null } });
    const row = { facility_id: 'f-1', user_id: 'u1', id: 'u1', email: 'owner@example.invalid', name: 'fixture', booking_count: 1 };
    pagedOverride(table, (offset) => offset === 0
      ? { data: Array(1000).fill(row), error: null }
      : { data: null, error: { message: 'later page unavailable' } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
    expect(mockFrom.mock.calls.some(([name]) => name === 'cron_report_sends')).toBe(false);
    expect(logCronRun).not.toHaveBeenCalledWith('weekly-report', 'success', expect.anything(), expect.anything());
  },
);

test.each(['daily_revenue_summary', 'facility_members', 'profiles', 'facility_profiles'])(
  '%sの安全上限に達した場合は部分成功扱いせず送信前に停止する', async (table) => {
    setupFrom({ rows: { data: [{ facility_id: 'f-1', booking_count: 1 }], error: null } });
    const row = { facility_id: 'f-1', user_id: 'u1', id: 'u1', email: 'owner@example.invalid', name: 'fixture', booking_count: 1 };
    pagedOverride(table, () => ({ data: Array(1000).fill(row), error: null }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
    expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(),
      expect.objectContaining({ error_msg: expect.stringContaining('maxRows=100000') }));
    expect(mockFrom.mock.calls.some(([name]) => name === 'cron_report_sends')).toBe(false);
  },
);

// ==========================================================================
// 日曜分の欠落（2026年10月22日）
// daily_revenue_summary の日曜の行は daily-summary（JST 月曜 15:00）が作るので、週次（JST 月曜 07:10）
// の時点ではまだ無い。週次は合算の前に期間内の 7 日を集計し直す。
// ==========================================================================
describe('週次の集計期間と集計し直し', () => {
  // UTC 2026-10-25 22:10 ＝ JST 2026-10-26（月）07:10。本番の実行時刻。
  const MONDAY_RUN = new Date('2026-10-25T22:10:00Z');
  const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];

  /**
   * 本番の状態を再現する小さな DB。月〜土の行は daily-summary が書き込み済みで、日曜（10-25）の行は
   * まだ無い。aggregate_daily_revenue を呼ぶと、その日の予約から行が作られる（上書き）。
   */
  function fakeSummaryTable(bookingsByDate: Record<string, { revenue: number; count: number }> = {
    '2026-10-20': { revenue: 10000, count: 1 },
    '2026-10-25': { revenue: 40000, count: 5 }, // 日曜
  }) {
    const table = new Map<string, Record<string, number | string>>();
    const put = (date: string) => {
      const b = bookingsByDate[date];
      if (!b) return;
      table.set(date, { facility_id: 'f-1', date, total_revenue: b.revenue, booking_count: b.count,
        completed_count: b.count, cancelled_count: 0, new_customer_count: 0, repeat_customer_count: 0 });
    };
    // daily-summary が月曜 15:00 までに書き込み済みの日（日曜はまだ）
    for (const date of WEEK.slice(0, 6)) put(date);
    mockRpc.mockImplementation(async (name: string, args: { p_date: string }) => {
      if (name !== 'aggregate_daily_revenue') return { data: null, error: { message: `unexpected rpc ${name}` } };
      put(args.p_date);
      return { data: 1, error: null };
    });
    const delegate = mockFrom.getMockImplementation()!;
    mockFrom.mockImplementation((name: string) => {
      if (name !== 'daily_revenue_summary') return delegate(name);
      let gte = '';
      let lte = '';
      const q: Record<string, unknown> = {
        select: () => q, order: () => q,
        gte: (_c: string, v: string) => { gte = v; return q; },
        lte: (_c: string, v: string) => { lte = v; return q; },
        range: () => Promise.resolve({
          data: [...table.values()].filter((r) => (r.date as string) >= gte && (r.date as string) <= lte),
          error: null,
        }),
      };
      return q;
    });
  }

  test('回帰: 日曜の行が週次の実行時点に無くても、日曜の売上・予約を含めて送る', async () => {
    jest.useFakeTimers({ now: MONDAY_RUN });
    setupFrom();
    fakeSummaryTable();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({
      periodStart: '2026-10-19', periodEnd: '2026-10-25',
      totalRevenue: 50000, bookingCount: 6, completedCount: 6,
    }));
  });

  test('回帰: その週に日曜しか予約が無い施設にも週次が届く', async () => {
    jest.useFakeTimers({ now: MONDAY_RUN });
    setupFrom();
    fakeSummaryTable({ '2026-10-25': { revenue: 40000, count: 5 } });
    await GET(makeRequest());
    expect(sendWeeklyReportEmail).toHaveBeenCalledTimes(1);
    expect(sendWeeklyReportEmail).toHaveBeenCalledWith(expect.objectContaining({ totalRevenue: 40000, bookingCount: 5 }));
  });

  test('合算の前に、月曜〜日曜の 7 日すべてを集計し直す（JST の日付で）', async () => {
    jest.useFakeTimers({ now: MONDAY_RUN });
    const order: string[] = [];
    mockRpc.mockImplementation(async (_name: string, args: { p_date: string }) => { order.push(`rpc:${args.p_date}`); return { data: 1, error: null }; });
    const delegate = mockFrom.getMockImplementation()!;
    mockFrom.mockImplementation((name: string) => { order.push(`from:${name}`); return delegate(name); });
    await GET(makeRequest());
    expect(mockRpc.mock.calls).toEqual(WEEK.map((d) => ['aggregate_daily_revenue', { p_date: d }]));
    expect(order.indexOf('from:daily_revenue_summary')).toBeGreaterThan(order.indexOf('rpc:2026-10-25'));
  });

  test('実行が水曜に遅れても、期間は同じ月曜〜日曜（二重送信の判定キーも同じ週）', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-28T03:00:00Z') }); // JST 10-28（水）12:00
    const json = await (await GET(makeRequest())).json();
    expect(json.start).toBe('2026-10-19');
    expect(json.end).toBe('2026-10-25');
    expect(mockRpc).toHaveBeenCalledTimes(7);
  });

  test('集計し直しが失敗したら、その週のレポートを送らず 500（古い・欠けた数字を送らない）', async () => {
    jest.useFakeTimers({ now: MONDAY_RUN });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockImplementation(async (_name: string, args: { p_date: string }) =>
      args.p_date === '2026-10-25' ? { data: null, error: { message: 'aggregate boom' } } : { data: 1, error: null });
    setupFrom({ rows: { data: [{ facility_id: 'f-1', total_revenue: 100, booking_count: 1 }], error: null } });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(sendWeeklyReportEmail).not.toHaveBeenCalled();
    expect(mockFrom.mock.calls.some(([name]) => name === 'daily_revenue_summary')).toBe(false);
    expect(mockFrom.mock.calls.some(([name]) => name === 'cron_report_sends')).toBe(false);
    expect(logCronRun).toHaveBeenCalledWith('weekly-report', 'error', expect.anything(), expect.objectContaining({
      error_msg: 'aggregate boom', meta: { start: '2026-10-19', end: '2026-10-25', failedDate: '2026-10-25' },
    }));
    errSpy.mockRestore();
  });
});
