/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * hero-tiny.webp はトップページのヒーロー画像だが、ルートレイアウトが全ページで preload していた
 * （他のページでは使われず、Chrome が「preload したのに使っていない」と警告し、毎回転送もしていた）。
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('the root layout does not preload the home hero on every page', () => {
  expect(read('src/app/layout.tsx')).not.toMatch(/rel="preload"[^>]*hero-tiny/);
});

test('the home page still requests its hero image with high priority', () => {
  const home = read('src/app/page.tsx');
  const img = home.slice(home.indexOf('src="/images/hero-tiny.webp"') - 200, home.indexOf('src="/images/hero-tiny.webp"') + 200);
  expect(img).toContain('src="/images/hero-tiny.webp"');
  expect(img).toContain('fetchPriority="high"');
});
