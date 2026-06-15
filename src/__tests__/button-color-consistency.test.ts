import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * ボタン色の一貫性ガード（T17 回帰防止）。
 *
 * primary ボタンの色を sky-600（hover:sky-700）に統一した。再発防止として:
 *  1. 旧 primary shade（bg-sky-500 + hover:bg-sky-600 を同一要素に持つボタン）を禁止。
 *  2. blue 系の primary ボタン（bg-blue-* + text-white + hover:bg-blue-*）を禁止。
 * いずれも「症状が出てから直す」のではなく、出る前に CI で物理ブロックする予防ガード。
 *
 * 注: 非ボタンの sky-500（Toggle スイッチ・アバター円・プログレスバー）や、
 * 意味色としての bg-blue-500（Toast の info・GBP 監査スコアバー）は hover ボタン条件に
 * 合致しないため誤検知しない。
 */

const ROOT = process.cwd();
const SCAN_DIRS = [join(ROOT, 'src/app'), join(ROOT, 'src/components')];

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...collectTsx(p));
    } else if (p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap(collectTsx);

describe('ボタン色の一貫性（T17 回帰防止）', () => {
  it('対象ファイルが収集できている（ガードの空振り防止）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('旧 primary shade（bg-sky-500 + hover:bg-sky-600）のボタンが存在しない', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('bg-sky-500') && line.includes('hover:bg-sky-600')) {
          offenders.push(`${f.replace(`${ROOT}/`, '')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('blue 系の primary ボタン（bg-blue-* + text-white + hover:bg-blue-*）が存在しない', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/bg-blue-(500|600|700)/.test(line) && line.includes('text-white') && /hover:bg-blue-/.test(line)) {
          offenders.push(`${f.replace(`${ROOT}/`, '')}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
