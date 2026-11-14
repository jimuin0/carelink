/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * hero-tiny.webp はトップページのヒーロー画像だが、ルートレイアウトが全ページで preload していた
 * （他のページでは使われず、Chrome が「preload したのに使っていない」と警告し、毎回転送もしていた）。
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/**
 * hero 画像を preload している箇所を返す。属性の順序（href が rel より前）・複数行の <link>・
 * react-dom の preload() 呼び出しのいずれの形でも拾う。コメント中の説明文は対象外。
 */
function heroPreloads(src: string): string[] {
  const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const links = [...code.matchAll(/<link\b[\s\S]*?\/?>/g)].map((m) => m[0])
    .filter((tag) => /rel=\{?["'`]preload["'`]\}?/.test(tag) && /hero-tiny/.test(tag));
  const calls = [...code.matchAll(/\bpreload\(\s*["'`][^"'`]*hero-tiny[^"'`]*["'`]/g)].map((m) => m[0]);
  return [...links, ...calls];
}

test('検出器は属性の順序・改行・preload() の形を問わず拾う（負の対照つき）', () => {
  expect(heroPreloads('<link rel="preload" as="image" href="/images/hero-tiny.webp" />')).toHaveLength(1);
  expect(heroPreloads('<link href="/images/hero-tiny.webp" as="image" rel="preload" />')).toHaveLength(1);
  expect(heroPreloads('<link\n  as="image"\n  href="/images/hero-tiny.webp"\n  rel="preload"\n/>')).toHaveLength(1);
  expect(heroPreloads("preload('/images/hero-tiny.webp', { as: 'image' });")).toHaveLength(1);
  expect(heroPreloads('<link rel="preload" href="/fonts/x.woff2" as="font" />')).toEqual([]);
  expect(heroPreloads('{/* hero-tiny.webp は全ページに preload しない */}')).toEqual([]);
});

test('the root layout does not preload the home hero on every page', () => {
  expect(heroPreloads(read('src/app/layout.tsx'))).toEqual([]);
});

test('the home page still requests its hero image with high priority', () => {
  const home = read('src/app/page.tsx');
  const img = home.slice(home.indexOf('src="/images/hero-tiny.webp"') - 200, home.indexOf('src="/images/hero-tiny.webp"') + 200);
  expect(img).toContain('src="/images/hero-tiny.webp"');
  expect(img).toContain('fetchPriority="high"');
});
