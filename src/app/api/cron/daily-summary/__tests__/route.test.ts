/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/daily-summary
 * 集計本体は RPC aggregate_daily_revenue（集合処理）に移行したため、ルートは
 *   - CRON_SECRET 認証
 *   - 前日(JST)の日付で RPC を1回呼ぶ
 *   - RPC 成功→processed / RPC エラー→500 / 例外→500
 * を検証する（集計ロジックそのものの正しさは DB 関数側＝SQL の責務）。
 */

jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email', () => ({ sendDailySummaryEmail: jest.fn() }));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendDailySummaryEmail } from '@/lib/email';
import { GET } from '../route';

const mockRpc = jest.fn();
const mockFrom = jest.fn();

function makeRequest() {
  return new Request('http://localhost/api/cron/daily-summary');
}

// await でも .maybeSingle() でも同じ resolved を返す chainable モック。
function chain(resolved: unknown) {
  const p = Promise.resolve(resolved);
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, in: () => obj, limit: () => obj,
    maybeSingle: () => Promise.resolve(resolved),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  };
  return obj;
}

// 各テーブルが返すデータを差し替えてメール送信オーケストレーションを検証する。
function setupEmailFrom(opts: {
  optedIn?: { facility_id: string }[];
  summaries?: Array<Record<string, number | string | null>>;
  owner?: { user_id: string } | null;
  prof?: { email?: string | null } | null;
  fac?: { name?: string } | null;
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_notification_settings') return chain({ data: opts.optedIn ?? [] });
    if (table === 'daily_revenue_summary') return chain({ data: opts.summaries ?? [] });
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
  (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc: mockRpc, from: mockFrom });
  (sendDailySummaryEmail as jest.Mock).mockResolvedValue(true);
  setupEmailFrom(); // 既定は opt-in 施設なし＝メール送信ゼロ（既存テストに影響しない）
});

test('CRON_SECRET 不正 → 401（RPC を呼ばない）', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(new Response('unauthorized', { status: 401 }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('集計成功 → processed に RPC 戻り値、前日(JST)の日付で呼ぶ', async () => {
  mockRpc.mockResolvedValue({ data: 5, error: null });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.processed).toBe(5);
  expect(json.skipped).toBe(0);
  expect(mockRpc).toHaveBeenCalledWith(
    'aggregate_daily_revenue',
    expect.objectContaining({ p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
  );
});

test('RPC 戻り値 null → processed 0', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.processed).toBe(0);
});

test('RPC エラー → 500 + error ログ', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith(
    'daily-summary',
    'error',
    expect.anything(),
    expect.objectContaining({ error_msg: expect.any(String) }),
  );
});

test('予期しない例外(Error) → 500', async () => {
  mockRpc.mockRejectedValue(new Error('unexpected'));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
});

test('予期しない例外(非Error) → 500（error_msg は String 化）', async () => {
  mockRpc.mockRejectedValue('string-error');
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith(
    'daily-summary',
    'error',
    expect.anything(),
    expect.objectContaining({ error_msg: 'string-error' }),
  );
});

describe('日次売上サマリーメール（email_daily_summary）', () => {
  beforeEach(() => { mockRpc.mockResolvedValue({ data: 1, error: null }); });

  test('opt-in 施設に売上サマリーメールを送る（メトリクス込み・emailsSent 計上）', async () => {
    setupEmailFrom({
      optedIn: [{ facility_id: 'f-1' }],
      summaries: [{
        facility_id: 'f-1', total_revenue: 12000, booking_count: 5, completed_count: 4,
        cancelled_count: 1, new_customer_count: 2, repeat_customer_count: 2,
      }],
    });
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.emailsSent).toBe(1);
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(expect.objectContaining({
      facilityEmail: 'owner@example.com', facilityName: 'テスト施設', totalRevenue: 12000, bookingCount: 5,
    }));
  });

  test('数値列が null でも 0 にフォールバックし施設名も既定で送る', async () => {
    setupEmailFrom({
      optedIn: [{ facility_id: 'f-1' }],
      summaries: [{
        facility_id: 'f-1', total_revenue: null, booking_count: null, completed_count: null,
        cancelled_count: null, new_customer_count: null, repeat_customer_count: null,
      }],
      fac: null,
    });
    await GET(makeRequest());
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(expect.objectContaining({
      totalRevenue: 0, bookingCount: 0, facilityName: '施設',
    }));
  });

  test('opt-in 施設なし → メール送信ゼロ', async () => {
    setupEmailFrom({ optedIn: [] });
    const json = await (await GET(makeRequest())).json();
    expect(json.emailsSent).toBe(0);
    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
  });

  test('当日サマリーが無い → メール送信ゼロ', async () => {
    setupEmailFrom({ optedIn: [{ facility_id: 'f-1' }], summaries: [] });
    const json = await (await GET(makeRequest())).json();
    expect(json.emailsSent).toBe(0);
    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
  });

  test('オーナー不在 → その施設はスキップ', async () => {
    setupEmailFrom({ optedIn: [{ facility_id: 'f-1' }], summaries: [{ facility_id: 'f-1', total_revenue: 1 }], owner: null });
    const json = await (await GET(makeRequest())).json();
    expect(json.emailsSent).toBe(0);
    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
  });

  test('オーナーのメール未登録 → スキップ', async () => {
    setupEmailFrom({ optedIn: [{ facility_id: 'f-1' }], summaries: [{ facility_id: 'f-1', total_revenue: 1 }], prof: { email: null } });
    const json = await (await GET(makeRequest())).json();
    expect(json.emailsSent).toBe(0);
    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
  });

  test('メール送信が false → emailsSent に計上しない', async () => {
    (sendDailySummaryEmail as jest.Mock).mockResolvedValue(false);
    setupEmailFrom({ optedIn: [{ facility_id: 'f-1' }], summaries: [{ facility_id: 'f-1', total_revenue: 1 }] });
    const json = await (await GET(makeRequest())).json();
    expect(json.emailsSent).toBe(0);
    expect(sendDailySummaryEmail).toHaveBeenCalled();
  });

  test('メール一括処理が例外でも集計成功は 200 を返す（non-blocking）', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.emailsSent).toBe(0);
  });
});
