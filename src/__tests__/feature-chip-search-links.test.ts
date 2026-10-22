/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 「こだわり条件」チップが features= で検索することを固定する（2026年10月22日 新設）。
 *
 * 【なぜ必要か】トップ・エリア×業種ページ・施設ページのチップは `/search?keyword=駐車場あり` を
 * 出していた。キーワード検索は施設名・紹介文などの文字列一致なので、features に「駐車場あり」を
 * 持つ施設が当たらず、紹介文に同じ語を含む無関係な施設が当たっていた。チップは
 * `featureSearchHref`（src/lib/search-href.ts）で組み立て、keyword= へ戻さない。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CHIP_FILES = [
  'src/components/home/HomeBelowFold.tsx',
  'src/app/[prefectureSlug]/[secondSlug]/page.tsx',
  'src/app/[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx',
  'src/app/facility/[slug]/page.tsx',
  'src/components/facility/AccessInfo.tsx',
];

const KEYWORD_CHIP = /keyword=\$\{encodeURIComponent\(feature\)\}/;

describe('こだわり条件チップの検索リンク', () => {
  test.each(CHIP_FILES)('%s は features= の検索リンクを使う', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).not.toMatch(KEYWORD_CHIP);
    expect(src).toMatch(/href=\{featureSearchHref\(feature[,)]/);
  });

  // 負の対照: 検出の正規表現が旧実装の書き方を実際に捕まえること。
  test('旧実装の keyword= チップは検出される', () => {
    const old = 'href={`/search?type=${encodeURIComponent(typeName)}&keyword=${encodeURIComponent(feature)}`}';
    expect(old).toMatch(KEYWORD_CHIP);
  });
});
