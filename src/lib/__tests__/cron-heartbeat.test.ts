/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * getStaleCronJobs（cron 死活監視の停止判定ロジック）のテスト。
 * （src/lib/__tests__ 規約: 素の node でなく Stryker mixin 環境を指定する）
 */

const mockFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

import { getStaleCronJobs } from '../cron-heartbeat';
import { CRON_JOBS, cronStaleThresholdMinutes } from '../cron-jobs';

const NOW = Date.UTC(2026, 6, 3, 0, 0, 0); // 固定（決定化）
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;

type JobResult = { data: { started_at: string } | null; error: { message: string } | null };

// 既定は全ジョブ「1分前に実行済み（fresh）」。overrides で個別ジョブを差し替える。
function setup(overrides: Record<string, JobResult> = {}) {
  mockFrom.mockImplementation(() => {
    let jobName = '';
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (_col: string, val: string) => { jobName = val; return chain; },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          jobName in overrides ? overrides[jobName] : { data: { started_at: iso(1 * MIN) }, error: null },
        ),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStaleCronJobs', () => {
  it('全ジョブが fresh → stale なし', async () => {
    setup();
    const { stale, queryErrors } = await getStaleCronJobs(NOW);
    expect(stale).toEqual([]);
    expect(queryErrors).toEqual([]);
  });

  it('閾値を超えて古いジョブを stale として返す', async () => {
    setup({ 'webhook-retry': { data: { started_at: iso(200 * MIN) }, error: null } });
    const { stale } = await getStaleCronJobs(NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      name: 'webhook-retry',
      ageMinutes: 200,
      thresholdMinutes: cronStaleThresholdMinutes(CRON_JOBS.find((j) => j.name === 'webhook-retry')!),
    });
  });

  it('excludeName のジョブは古くても対象外', async () => {
    setup({
      'cron-heartbeat': { data: { started_at: iso(9999 * MIN) }, error: null }, // 極端に古い
      'flag-reviews': { data: { started_at: iso(9999 * MIN) }, error: null },
    });
    const { stale } = await getStaleCronJobs(NOW, { excludeName: 'cron-heartbeat' });
    const names = stale.map((s) => s.name);
    expect(names).not.toContain('cron-heartbeat');
    expect(names).toContain('flag-reviews');
  });

  it('DB エラーのジョブは stale としない（判定不能）→ queryErrors に可視化', async () => {
    setup({ 'daily-summary': { data: null, error: { message: 'boom' } } });
    const { stale, queryErrors } = await getStaleCronJobs(NOW);
    expect(stale.map((s) => s.name)).not.toContain('daily-summary');
    expect(queryErrors).toContain('daily-summary: boom');
  });

  it('実行履歴が無いジョブ（新規追加直後）は stale としない', async () => {
    setup({ 'birthday-coupon': { data: null, error: null } });
    const { stale } = await getStaleCronJobs(NOW);
    expect(stale.map((s) => s.name)).not.toContain('birthday-coupon');
  });

  it('境界: 経過が閾値ちょうど → stale でない / 閾値超 → stale', async () => {
    const job = CRON_JOBS.find((j) => j.name === 'flag-reviews')!;
    const threshold = cronStaleThresholdMinutes(job); // 60*... flag-reviews は intervalMinutes=60 → 60*2+30=150
    // ちょうど閾値
    setup({ 'flag-reviews': { data: { started_at: iso(threshold * MIN) }, error: null } });
    expect((await getStaleCronJobs(NOW)).stale.map((s) => s.name)).not.toContain('flag-reviews');
    // 閾値+1分
    setup({ 'flag-reviews': { data: { started_at: iso((threshold + 1) * MIN) }, error: null } });
    expect((await getStaleCronJobs(NOW)).stale.map((s) => s.name)).toContain('flag-reviews');
  });
});
