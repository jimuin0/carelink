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
});
