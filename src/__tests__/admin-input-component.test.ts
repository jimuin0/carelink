import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * 管理ページのテキスト入力の共通部品化ガード（T32 回帰防止）。
 *
 * テキスト入力は globals.css の .form-input を直書きせず、共通部品
 * `@/components/admin/SbUi` の <SbInput> を使う（見た目・a11y を単一ソース化）。
 * 再発防止として、admin 配下で生 <input> に form-input クラスを直書きする記述を禁止する。
 * （checkbox/radio/file など form-input を使わない input は対象外で誤検知しない）
 */

const ROOT = process.cwd();
const ADMIN_DIR = join(ROOT, 'src/app/admin');

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

const files = collectTsx(ADMIN_DIR);

describe('管理ページのテキスト入力の共通部品化（T32 回帰防止）', () => {
  it('対象ファイルが収集できている（ガードの空振り防止）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('admin 配下に form-input を直書きした生 <input> が存在しない（SbInput を使う）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // <input ... form-input ...> を1要素として検出（属性が複数行に渡る場合も考慮し
      // <input から最初の > までを走査する）。
      const re = /<input\b[^>]*>/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (m[0].includes('form-input')) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${f.replace(`${ROOT}/`, '')}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
