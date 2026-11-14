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

// 監査 A168: 市区町村×業種ページのチップが都道府県だけを渡し、市区町村の絞り込みが失われていた。
test('市区町村×業種ページのチップは市区町村を渡し、/search はそれで絞り込む', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx'), 'utf8');
  expect(page).toContain('featureSearchHref(feature, { type: typeValue, area: prefName, city: cityName })');
  const search = readFileSync(join(process.cwd(), 'src/app/search/page.tsx'), 'utf8');
  expect(search).toContain('city: searchParams.area ? searchParams.city : undefined');
  expect(search).toContain("baseParams.set('city', searchParams.city)");
  const filters = readFileSync(join(process.cwd(), 'src/components/search/SearchFilters.tsx'), 'utf8');
  expect(filters).toContain("params.set('city', city)");
});
