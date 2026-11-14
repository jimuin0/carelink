/**
 * 監査 A191: 施設配下のパンくず「トップ」の行き先が、ページによって / と /search に分かれていた。
 * トップは / に統一する（施設詳細・ブログと同じ）。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : pages(p);
    return name === 'page.tsx' ? [p] : [];
  });
}

const TOP_LINK = /<Link href="([^"]+)"[^>]*>トップ<\/Link>/g;

test('施設配下のパンくず「トップ」はすべて / を指す', () => {
  const found: string[] = [];
  for (const file of pages(join(process.cwd(), 'src/app/facility/[slug]'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(TOP_LINK)) found.push(`${file}:${m[1]}`);
  }
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((f) => !f.endsWith(':/'))).toEqual([]);
});

test('負の対照: /search を指すトップリンクを検出できる', () => {
  expect([...'<Link href="/search" className="x">トップ</Link>'.matchAll(TOP_LINK)].map((m) => m[1])).toEqual(['/search']);
});
