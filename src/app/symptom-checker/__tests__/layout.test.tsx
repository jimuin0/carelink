/** @jest-environment node */
/**
 * 症状チェッカーは、選べる症状のどれにも公開施設が無い間は検索結果に出さない
 * （2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * 本番は対応症状が 0 行で、どの症状を選んでも「0件 対応店舗」になるのに sitemap 掲載・index 可だった。
 */
import { generateMetadata } from '../layout';
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
