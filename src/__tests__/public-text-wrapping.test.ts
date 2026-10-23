/**
 * 公開ページの日本語の折り返しとパンくずリスト（2026年10月23日）。
 *
 * - 見出しが「サロン・クリニックを探/す」のように語の途中で割れていたので、文節で折り返す
 *   ユーティリティ（jp-balance / jp-pretty）をサイト全体で使えるようにした。
 *   /register の .theme-ecru .jp-wrap はテーマの中でしか効かないので、それとは別に置く。
 * - スマホのパンくずリストが「トッ/プ」のように 1 文字ずつ折れていたので、全てのパンくずに
 *   crumbs（項目内は折り返さず、収まらなければ横スクロール）を付ける。
 *   次に足されるパンくずも守るため、aria-label="パンくずリスト" を持つ全ファイルを走査する。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

function utilityBody(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
}

test('jp-balance / jp-pretty はテーマの外（サイト全体）で定義されている', () => {
  expect(utilityBody('jp-balance')).toMatch(/word-break:\s*auto-phrase;[\s\S]*text-wrap:\s*balance;/);
  expect(utilityBody('jp-pretty')).toMatch(/word-break:\s*auto-phrase;[\s\S]*text-wrap:\s*pretty;/);
});

test.each([
  ['src/app/page.tsx', /<h1 className="jp-balance[^"]*"[^>]*>\s*ネットでかんたんサロン予約/],
  ['src/app/page.tsx', /<p className="jp-balance[^"]*"[^>]*>\s*ヘア・ネイル/],
  ['src/components/facility/FacilityHeader.tsx', /<h1 className="jp-balance[^"]*">\{facility\.name\}/],
  ['src/components/facility/FacilityHeader.tsx', /<p className="jp-pretty[^"]*">\{facility\.catch_copy\}/],
  ['src/app/search/page.tsx', /<h1 className="jp-balance[^"]*">サロン・クリニックを探す/],
])('%s の見出しは文節で折り返す', (file, pattern) => {
  expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(pattern);
});

test('crumbs は項目の中で折り返さず、収まらなければ横にスクロールさせる', () => {
  const body = utilityBody('crumbs');
  expect(body).toMatch(/overflow-x:\s*auto;/);
  expect(body).toMatch(/& > li \{[\s\S]*white-space:\s*nowrap;[\s\S]*flex-shrink:\s*0;/);
});

test('全てのパンくずリストに crumbs が付いている', () => {
  const files = [...walk(join(ROOT, 'src/app')), ...walk(join(ROOT, 'src/components'))]
    .filter((f) => readFileSync(f, 'utf8').includes('aria-label="パンくずリスト"'));
  // 空振り防止: 共通コンポーネントと施設詳細の手書きのパンくずが含まれていること
  const names = files.map((f) => relative(ROOT, f));
  expect(names).toEqual(expect.arrayContaining(['src/components/Breadcrumb.tsx', 'src/app/facility/[slug]/page.tsx']));
  const missing = files.filter((f) => {
    const src = readFileSync(f, 'utf8');
    let from = 0;
    let index: number;
    while ((index = src.indexOf('aria-label="パンくずリスト"', from)) !== -1) {
      const ol = src.slice(src.indexOf('<ol', index), src.indexOf('>', src.indexOf('<ol', index)));
      if (!/className="[^"]*\bcrumbs\b/.test(ol)) return true;
      from = index + 1;
    }
    return false;
  });
  expect(missing.map((f) => relative(ROOT, f))).toEqual([]);
});
