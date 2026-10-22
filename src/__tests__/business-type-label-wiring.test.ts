/**
 * 業種「鍼灸院・整骨院」を画面では「鍼灸院・整骨院・整体」と表示する配線を固定する
 * （2026年10月23日 神原さん決定：整体を含める）。
 *
 * 保存値（business_type）・URL の ?type=・/type/acupuncture は変えない。既存の施設・受付の行、
 * 外部に出回っている検索 URL、DB 側の受付関数が許可する業種の列挙がこの文字列を持つため。
 * 表示する場所だけを src/lib/business-type-label.ts の businessTypeLabel() に通す。
 *
 * 守るもの:
 *   - 業種を表示している画面が businessTypeLabel() を通している（1 画面だけ旧名が残らない）
 *   - フォームの <option> は value に保存値・表示に表示名（送信値は従来どおり）
 *   - DB（migration）の業種の列挙を書き換えていない
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** 業種名を利用者・店舗に見せている画面（表示名を通すこと）。 */
const DISPLAY_SURFACES = [
  // フォーム（店舗が選ぶ）
  'src/components/register/RegisterForm.tsx',
  'src/app/recruit/page.tsx',
  'src/app/admin/settings/page.tsx',
  'src/app/admin/onboarding/page.tsx',
  // 検索・絞り込み・回遊
  'src/components/search/SearchBar.tsx',
  'src/components/search/SearchFilters.tsx',
  'src/components/search/SearchHeader.tsx',
  'src/components/search/SearchFooter.tsx',
  'src/components/search/SearchSuggest.tsx',
  'src/components/Footer.tsx',
  'src/app/page.tsx',
  'src/components/home/HomeBelowFold.tsx',
  'src/app/search/page.tsx',
  // 施設カード・施設ページ・比較
  'src/components/search/FacilityCard.tsx',
  'src/components/facility/FacilityHeader.tsx',
  'src/components/facility/RecentlyViewed.tsx',
  'src/app/facility/[slug]/page.tsx',
  'src/app/compare/page.tsx',
  // 業種ページ・エリア×業種ページ（title・見出し・パンくず）
  'src/app/type/[typeSlug]/page.tsx',
  'src/app/[prefectureSlug]/page.tsx',
  'src/app/[prefectureSlug]/[secondSlug]/page.tsx',
  'src/app/[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx',
  'src/components/seo/RelatedLinks.tsx',
  'src/lib/seo-snippets.ts',
  'src/lib/area-seo.ts',
  'src/lib/symptom-fallback.ts',
  // 受付・控え・管理
  'src/app/register/complete/page.tsx',
  'src/app/register/recover/page.tsx',
  'src/components/register/RegistrationReceipt.tsx',
  'src/components/admin/RegistrationDuplicateLink.tsx',
  'src/app/admin/featured-ads/page.tsx',
];

const FORMS = [
  'src/components/register/RegisterForm.tsx',
  'src/app/recruit/page.tsx',
  'src/app/admin/settings/page.tsx',
  'src/app/admin/onboarding/page.tsx',
  'src/components/search/SearchBar.tsx',
  'src/components/search/SearchFilters.tsx',
];

describe('業種の表示名の配線', () => {
  it.each(DISPLAY_SURFACES)('%s は businessTypeLabel() を通して表示する', (file) => {
    expect(read(file)).toMatch(/businessTypeLabel\(/);
  });

  it.each(FORMS)('%s の選択肢は value に保存値・表示に表示名', (file) => {
    const source = read(file);
    expect(source).toMatch(/<option key=\{t\} value=\{t\}>\{businessTypeLabel\(t\)\}<\/option>/);
    expect(source).not.toMatch(/<option key=\{t\} value=\{businessTypeLabel/);
  });

  it('業種ページ・エリア×業種ページは保存値で検索し、表示名で見せる', () => {
    for (const file of [
      'src/app/type/[typeSlug]/page.tsx',
      'src/app/[prefectureSlug]/[secondSlug]/page.tsx',
      'src/app/[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx',
    ]) {
      const source = read(file);
      // 件数・一覧の読み取りは保存値（typeValue）
      expect(source).toMatch(/countAreaListing\([^)]*typeValue\)/);
      expect(source).toMatch(/loadAreaListingPage\([^)]*typeValue,/);
      expect(source).not.toMatch(/(countAreaListing|loadAreaListingPage)\([^)]*typeName/);
      expect(source).toContain('const typeName = businessTypeLabel(typeValue)');
    }
  });

  it('施設カードの業種バッジも表示名', () => {
    expect(read('src/components/search/FacilityCard.tsx')).toContain('{businessTypeLabel(facility.business_type)}');
  });

  it('DB（migration）の業種の列挙は書き換えていない（既存行・受付関数を壊さない）', () => {
    const dir = join(ROOT, 'supabase/migrations');
    const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(all).toContain("'鍼灸院・整骨院'");
    expect(all).not.toContain('鍼灸院・整骨院・整体');
  });
});
