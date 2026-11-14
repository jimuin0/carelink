/**
 * 症状・都道府県の SEO 固定文言が、根拠の無い断定をしないことを固定する（点検 A100 / A101）。
 *
 * - symptom-seo: 鍼灸の効果を断定し改善率を示唆する文言（「1回でも実感する方が多い」
 *   「ほとんどの方が改善を実感」等）をプラットフォーム名義で出していた。あはき法の広告制限・
 *   医療広告ガイドラインの効果断定の禁止に抵触し得る。
 * - prefecture-seo: 実際の掲載件数と無関係に「多数掲載しています」「全域の施設をネット予約可能です」
 *   と断定していた。掲載0件の県でもそのまま表示される（優良誤認・利用者の空振り）。
 *
 * 文言はデータとして全ページに出るため、言い回しの再混入を機械で止める。
 */
import { symptomSeo } from '@/data/symptom-seo';
import { prefectureSeo } from '@/data/prefecture-seo';

function allText(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (Array.isArray(obj)) return obj.flatMap(allText);
  if (obj && typeof obj === 'object') return Object.values(obj).flatMap(allText);
  return [];
}

describe('SEO 固定文言は根拠の無い断定をしない', () => {
  const symptomTexts = allText(symptomSeo);
  const prefTexts = allText(prefectureSeo);

  it('走査対象が空ではない（空振り防止）', () => {
    expect(symptomTexts.length).toBeGreaterThan(100);
    expect(prefTexts.length).toBeGreaterThan(200);
  });

  it.each([
    /実感する方が多い/,
    /(多くの|ほとんどの)方が改善/,
    /改善を実感されます/,
    /副作用(なく|の無い|のない)/,
    /相乗効果/,
    /成功率(を上げる|向上)/,
    /回復が早まり?ま/,
    /鍼灸[^。]*(効果的です|有効です|有効とされ|有効な選択肢)/,
  ])('症状ページに効果断定 %p が無い', (re) => {
    expect(symptomTexts.filter((t) => re.test(t))).toEqual([]);
  });

  it.each([
    /多数掲載/,
    /多く掲載/,
    /複数掲載/,
    /ネット予約可能です/,
    /CareLinkで(掲載|網羅)/,
    /掲載しています/,
  ])('都道府県ページに掲載状況の断定 %p が無い', (re) => {
    expect(prefTexts.filter((t) => re.test(t))).toEqual([]);
  });
});
