/**
 * load-tests/*.js は k6 が素の JavaScript として読む。TypeScript の型注釈
 * （`const params: string[] = []`）が混入して構文エラーになり、npm run test:load が
 * 一度も起動しない状態が続いていた。全ファイルを node の構文検査に通して再発を止める。
 */
import { execFileSync } from 'child_process';
import { copyFileSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DIR = join(process.cwd(), 'load-tests');
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));

describe('load-tests の構文', () => {
  it('走査対象が空振りしていない', () => {
    expect(files).toEqual(expect.arrayContaining(['search-load.js']));
  });

  it.each(files)('%s は JavaScript として構文解析できる', (f) => {
    // .js のまま --check すると Node 22 のモジュール自動判定が構文エラーを見逃して 0 で終わる
    // （実測）。k6 のスクリプトは ES Module なので .mjs として検査する。
    const copy = join(mkdtempSync(join(tmpdir(), 'k6-syntax-')), `${f}.mjs`);
    copyFileSync(join(DIR, f), copy);
    expect(() => execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' })).not.toThrow();
  });
});
