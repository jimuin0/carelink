/**
 * 監査 A200: 都道府県・業種・ランキングの一覧ページが next/link のままで、viewport 内のリンクの
 * 動的ルート先読みにより表示しただけで SSR が多数走っていた（CLAUDE.md「既知の罠」Next 16 の先読み）。
 * 一覧・回遊リンクは BrowseLink（既定 prefetch={false}）を使う。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const LISTING_PAGES = [
  'src/app/type/[typeSlug]/page.tsx',
  'src/app/ranking/page.tsx',
  'src/app/ranking/[area]/page.tsx',
];

test.each(LISTING_PAGES)('%s は BrowseLink を使い、next/link を直接 import しない', (file) => {
  const src = readFileSync(join(process.cwd(), file), 'utf8');
  expect(src).toMatch(/import Link from '@\/components\/BrowseLink';/);
  expect(src).not.toMatch(/from 'next\/link'/);
});
