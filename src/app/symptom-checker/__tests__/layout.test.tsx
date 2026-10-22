/** @jest-environment node */
/**
 * 症状チェッカーは、選べる症状のどれにも公開施設が無い間は検索結果に出さない
 * （2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * 本番は対応症状が 0 行で、どの症状を選んでも「0件 対応店舗」になるのに sitemap 掲載・index 可だった。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SymptomCheckerLayout, { generateMetadata } from '../layout';
import { getSymptomSlugsWithPublishedFacilities } from '@/lib/symptom-coverage';

jest.mock('@/lib/symptom-coverage', () => ({ getSymptomSlugsWithPublishedFacilities: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('公開施設の結びついた症状が 1 つも無ければ noindex, follow', async () => {
  (getSymptomSlugsWithPublishedFacilities as jest.Mock).mockResolvedValue(new Set());
  await expect(generateMetadata()).resolves.toMatchObject({
    title: '症状チェッカー',
    alternates: { canonical: '/symptom-checker' },
    robots: { index: false, follow: true },
  });
});

test('1 症状でも公開施設があれば robots を出さない（index に戻る）', async () => {
  (getSymptomSlugsWithPublishedFacilities as jest.Mock).mockResolvedValue(new Set(['low-back-pain']));
  const metadata = await generateMetadata();
  expect(metadata).not.toHaveProperty('robots');
  expect(metadata.title).toBe('症状チェッカー');
});

test('読み取りに失敗したら「施設なし」と取り違えず例外にする', async () => {
  (getSymptomSlugsWithPublishedFacilities as jest.Mock).mockRejectedValue(new Error('Symptom coverage unavailable'));
  await expect(generateMetadata()).rejects.toThrow('Symptom coverage unavailable');
});

/**
 * Next 16 の metadata は本文と別に描画されるため、metadata だけが読み取りに失敗すると本文が 200 で返り、
 * title・canonical・robots が 1 つも出ない（＝障害中のページが index 可になる）。layout 本体でも同じ読み取りを
 * 待ち、失敗を描画ツリーから例外にする（error.tsx の 5xx になる）。
 */
describe('layout 本体も同じ読み取りを待つ', () => {
  test('読み取りに失敗したら layout 本体も例外にする（metadata だけ欠けた 200 にしない）', async () => {
    (getSymptomSlugsWithPublishedFacilities as jest.Mock).mockRejectedValue(new Error('Symptom coverage unavailable'));
    await expect(SymptomCheckerLayout({ children: <p>checker</p> })).rejects.toThrow('Symptom coverage unavailable');
  });

  test('読めれば子をそのまま描画する（症状の有無で本文は変えない）', async () => {
    (getSymptomSlugsWithPublishedFacilities as jest.Mock).mockResolvedValue(new Set());
    const html = renderToStaticMarkup(await SymptomCheckerLayout({ children: <p>checker</p> }));
    expect(html).toBe('<p>checker</p>');
    expect(getSymptomSlugsWithPublishedFacilities).toHaveBeenCalledTimes(1);
  });
});
