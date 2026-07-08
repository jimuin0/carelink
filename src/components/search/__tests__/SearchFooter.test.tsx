/**
 * @jest-environment node
 *
 * majorCities（検索結果フッターの主要都市クイックリンク）の各エントリが
 * src/data/city-slugs.ts に実在するかを機械検証する回帰テスト。
 *
 * 【2026年7月8日 実データで確定した根治の再発防止】区レベルのslugを持たない道府県
 * （東京・大阪以外）にハードコードされた区レベルslugを指定すると、
 * [prefectureSlug]/[secondSlug]/page.tsx の isValidCitySlug に該当せず notFound() になる
 * （実データ確認: 修正前は /kanagawa/yokohama-nishi 等が404だった）。
 * このテストは、今後 majorCities に都市を追加する際に同じ種類の404を機械的に検知する。
 */
import { majorCities } from '../SearchFooter';
import { isValidCitySlug } from '@/data/city-slugs';

describe('SearchFooter majorCities', () => {
  const flat = majorCities.flatMap(({ pref, cities }) => cities.map((c) => ({ pref, ...c })));
  test.each(flat)('$pref/$slug（$name）は city-slugs.ts に実在する', ({ pref, slug }) => {
    expect(isValidCitySlug(pref, slug)).toBe(true);
  });
});
