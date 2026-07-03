import { readFileSync } from 'fs';
import { join } from 'path';
import { CRON_JOBS } from '@/lib/cron-jobs';

/**
 * render.yaml（Render Cron Jobs 定義）が SSOT src/lib/cron-jobs.data.json と一致することを保証する。
 * ジョブ追加/改名/スケジュール変更で render.yaml だけ・SSOT だけ更新するドリフトを CI で物理検知する
 * （cron.yml の cron-jobs-drift.test.ts と同型の発症前予防）。
 */

const yml = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');

interface CronService {
  name?: string;
  schedule?: string;
  start?: string;
}

/** render.yaml の "- type: cron" ブロックごとに name / schedule / startCommand を抽出。 */
function parseCronServices(text: string): CronService[] {
  const blocks = text.split(/^ {2}- type: cron\s*$/m).slice(1);
  return blocks.map((b) => ({
    name: b.match(/^\s*name:\s*(\S+)/m)?.[1],
    schedule: b.match(/^\s*schedule:\s*"([^"]+)"/m)?.[1],
    start: b.match(/^\s*startCommand:\s*(.+)$/m)?.[1]?.trim(),
  }));
}

const services = parseCronServices(yml);
const byName = new Map(services.map((s) => [s.name, s]));

describe('render.yaml と cron SSOT の整合（Render Cron Jobs ドリフト検知）', () => {
  it('render.yaml に cron サービスが抽出できる', () => {
    expect(services.length).toBeGreaterThan(0);
    // 15 機能ジョブ + health-check = 16
    expect(services.length).toBe(CRON_JOBS.length + 1);
  });

  it('全機能ジョブが carelink-<name> として存在し schedule が SSOT と一致', () => {
    for (const job of CRON_JOBS) {
      const svc = byName.get(`carelink-${job.name}`);
      expect(svc).toBeDefined(); // 欠けていれば carelink-<name> が render.yaml に無い
      expect(svc!.schedule).toBe(job.schedule);
    }
  });

  it('全機能ジョブの startCommand が cron-call.mjs <name> で name が一致', () => {
    for (const job of CRON_JOBS) {
      const svc = byName.get(`carelink-${job.name}`);
      expect(svc!.start).toBe(`node scripts/cron-call.mjs ${job.name}`);
    }
  });

  it('外形監視 carelink-health-check が存在し health-check.mjs を実行', () => {
    const hc = byName.get('carelink-health-check');
    expect(hc).toBeDefined();
    expect(hc!.start).toBe('node scripts/health-check.mjs');
    expect(hc!.schedule).toBeTruthy();
  });

  it('SSOT に無い余分な機能 cron が render.yaml に無い（health-check 以外は全て SSOT 由来）', () => {
    const ssotNames = new Set(CRON_JOBS.map((j) => `carelink-${j.name}`));
    for (const svc of services) {
      if (svc.name === 'carelink-health-check') continue;
      expect(ssotNames.has(svc.name!)).toBe(true); // false なら SSOT に無い余分な cron

    }
  });
});
