import { readFileSync } from 'fs';
import { join } from 'path';
import { CRON_JOB_NAMES, CRON_JOB_LABELS, CRON_JOBS } from '@/lib/cron-jobs';

/**
 * D-7: cron ジョブ一覧の三重管理ドリフト検知。
 * SSOT(src/lib/cron-jobs.ts)と .github/workflows/cron.yml の 3 箇所
 *  (matrix job リスト / 手動 dispatch の ALLOWED_JOBS / schedule→path の case)
 * が完全一致することを保証する。どれかにジョブを追加/改名して他を忘れると CI で落ちる。
 */

const yml = readFileSync(join(process.cwd(), '.github/workflows/cron.yml'), 'utf8');
const expected = [...CRON_JOB_NAMES].sort();

/** '/api/cron/foo' 群 → ['foo', ...]（ソート済み）。 */
function toNames(paths: string[]): string[] {
  return paths.map((p) => p.replace('/api/cron/', '')).sort();
}

describe('cron ジョブ SSOT と cron.yml の整合（D-7 ドリフト検知）', () => {
  it('SSOT: 全ジョブに表示ラベルがあり重複が無い', () => {
    expect(CRON_JOBS.length).toBe(CRON_JOB_NAMES.length);
    expect(new Set(CRON_JOB_NAMES).size).toBe(CRON_JOB_NAMES.length); // 重複なし
    for (const name of CRON_JOB_NAMES) {
      expect(CRON_JOB_LABELS[name]).toBeTruthy();
    }
  });

  it('cron.yml の matrix job リストが SSOT と一致', () => {
    const matrix = [...yml.matchAll(/^\s*-\s*(\/api\/cron\/[a-z0-9-]+)\s*$/gm)].map((m) => m[1]);
    expect(matrix.length).toBeGreaterThan(0);
    expect(toNames(matrix)).toEqual(expected);
  });

  it('cron.yml の ALLOWED_JOBS(手動 dispatch allowlist)が SSOT と一致', () => {
    const line = yml.split('\n').find((l) => l.includes('ALLOWED_JOBS='));
    expect(line).toBeDefined();
    const paths = [...line!.matchAll(/\/api\/cron\/[a-z0-9-]+/g)].map((m) => m[0]);
    expect(toNames(paths)).toEqual(expected);
  });

  it('cron.yml の schedule case の path が SSOT と一致', () => {
    const cases = [...yml.matchAll(/P="(\/api\/cron\/[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(0);
    expect(toNames(cases)).toEqual(expected);
  });

  // --- schedule / intervalMinutes の整合（heartbeat の期待間隔ドリフト防止）---

  /** case 行 "<cron>") P="/api/cron/<name>" から name→schedule を抽出。 */
  const caseScheduleByName: Record<string, string> = {};
  for (const m of yml.matchAll(/"([^"]+)"\)\s*P="\/api\/cron\/([a-z0-9-]+)"/g)) {
    caseScheduleByName[m[2]] = m[1];
  }

  it('cron.yml の case schedule 式が SSOT.schedule と厳密一致', () => {
    const fromSsot = Object.fromEntries(CRON_JOBS.map((j) => [j.name, j.schedule]));
    expect(caseScheduleByName).toEqual(fromSsot);
  });

  it('SSOT.schedule が全て on.schedule に存在する', () => {
    const scheduled = new Set(
      [...yml.matchAll(/-\s*cron:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    for (const j of CRON_JOBS) {
      expect(scheduled.has(j.schedule)).toBe(true);
    }
  });

  it('SSOT.intervalMinutes が schedule 式と整合（内部矛盾防止）', () => {
    // 対応する分頻度に分類する。未知パターンは null → テスト失敗させて明示対応を強制する。
    const classify = (expr: string): number | null => {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) return null;
      const [min, hour, dom, mon, dow] = parts;
      if (dom !== '*' || mon !== '*') return null;
      const step = min.match(/^\*\/(\d+)$/);
      if (step && hour === '*' && dow === '*') return parseInt(step[1], 10);
      if (/^\d+(,\d+)*$/.test(min) && hour === '*' && dow === '*') {
        return Math.round(60 / min.split(',').length);
      }
      const minNum = /^\d+$/.test(min);
      const hourNum = /^\d+$/.test(hour);
      if (minNum && hour === '*' && dow === '*') return 60;
      if (minNum && hourNum && dow === '*') return 1440;
      if (minNum && hourNum && /^\d+$/.test(dow)) return 10080;
      return null;
    };
    for (const j of CRON_JOBS) {
      expect(classify(j.schedule)).toBe(j.intervalMinutes);
    }
  });
});
