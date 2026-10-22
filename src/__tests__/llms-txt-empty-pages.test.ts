import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * AI 検索向けの案内（public/llms.txt）に、施設が 1 件も載らないページを主要 URL として掲げない
 * （2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 *
 * 症状ページ・症状チェッカーは対応症状を登録する手段がまだ無く（本番の facility_symptoms は 0 行）、
 * ランキングは口コミのある施設だけを並べる（本番の口コミは 0 件）。どちらも sitemap から外し、
 * ページ側も施設 0 件なら noindex にしたのに、llms.txt だけが「症状チェッカー: 症状から最適施設を提案」
 * 「ランキング」「症状詳細 /symptom/{slug}」を案内し続けていた。
 *
 * llms.txt は静的ファイルで sitemap のように実データで出し分けできない。施設・口コミが載って
 * これらのページが sitemap に戻ったら、このテストと合わせて llms.txt に足し戻すこと。
 */
const llms = readFileSync(join(process.cwd(), 'public/llms.txt'), 'utf8');

describe('llms.txt は施設の載らないページを案内しない', () => {
  it.each([
    ['症状チェッカー', '/symptom-checker'],
    ['ランキング', '/ranking'],
    ['症状詳細', '/symptom/'],
  ])('%s（%s）を載せない', (_label, path) => {
    expect(llms).not.toContain(path);
  });

  it('症状から探せるとは書かない', () => {
    expect(llms).not.toMatch(/症状(別チェッカー|から施設を検索|から最適施設)/);
    expect(llms).not.toContain('地域・業種・症状');
  });

  it('施設の載るページの案内は残す（空振りで緑にしない）', () => {
    expect(llms).toContain('https://carelink-jp.com/search');
    expect(llms).toContain('/facility/{slug}');
  });
});
