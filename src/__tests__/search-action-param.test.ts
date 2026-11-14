/**
 * B8-L2: 構造化データ（WebSite の SearchAction）が指す検索 URL のパラメータ名を、
 * 検索画面が実際に読むもの（keyword）と一致させる。q を指すと検索結果が無指定と同じになる。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

test('SearchAction の urlTemplate は検索画面が読む keyword を使う', () => {
  const layout = read('src/app/layout.tsx');
  const m = layout.match(/urlTemplate:\s*"https:\/\/carelink-jp\.com\/search\?(\w+)=\{search_term_string\}"/);
  expect(m).not.toBeNull();
  expect(m![1]).toBe('keyword');
  expect(read('src/app/search/page.tsx')).toContain('searchParams.keyword');
});
