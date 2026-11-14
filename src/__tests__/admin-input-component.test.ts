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


/**
 * `<input ...>` 要素を1つずつ取り出す。`{...}` の式の中と文字列の中の `>` では閉じない
 * （`onChange={(e) => ...}` のアロー関数の `>` で止まると、後ろの className を見落とすため）。
 */
export function inputTags(src: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  const re = /<input\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    out.push({ index: m.index, text: src.slice(m.index, i + 1) });
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
      for (const tag of inputTags(src)) {
        if (tag.text.includes('form-input')) {
          const line = src.slice(0, tag.index).split('\n').length;
          offenders.push(`${f.replace(`${ROOT}/`, '')}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('負の対照: アロー関数の > の後ろにある form-input も見つける', () => {
    const src = `<input value={v} onChange={(e) => setV(e.target.value)} className="form-input" />\n<input type="checkbox" />`;
    const tags = inputTags(src);
    expect(tags).toHaveLength(2);
    expect(tags[0].text).toContain('form-input');
    expect(tags[1].text).not.toContain('form-input');
    // 文字列中の > でも閉じない
    expect(inputTags(`<input placeholder="a > b" className="form-input" />`)[0].text).toContain('form-input');
  });
});
