/**
 * @jest-environment jsdom
 *
 * 特集一覧（/feature）のカードの画像（2026年10月23日）。
 * 画像が未登録の特集は、新聞のアイコンではなくトップの特集バナーと同じ業種の写真を出す
 * （本番の特集 3 件とも banner_image_url が空で、一覧だけアイコンになっていた）。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

const mockGetPublishedFeatures = jest.fn();
jest.mock('@/lib/features', () => ({ getPublishedFeatures: () => mockGetPublishedFeatures() }));
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import FeatureListPage from '../page';

const base = { description: null, content: null, filter_keyword: null, filter_prefecture: null, display_order: 0, published_at: null };

test('画像が未登録なら業種の写真、登録済みならその画像。どちらも無ければアイコンも出さない', async () => {
  mockGetPublishedFeatures.mockResolvedValue([
    { ...base, id: '1', slug: 'spring-hair-2026', title: '春のヘアチェンジ特集', banner_image_url: null, filter_type: 'ヘアサロン' },
    { ...base, id: '2', slug: 'own', title: '独自画像の特集', banner_image_url: 'https://example.invalid/own.webp', filter_type: 'ヘアサロン' },
    { ...base, id: '3', slug: 'none', title: '業種の無い特集', banner_image_url: null, filter_type: null },
  ]);
  const { container } = render(await FeatureListPage());
  const cards = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/feature/'));
  expect(cards.map((c) => c.querySelector('img')?.getAttribute('src') ?? null)).toEqual([
    '/images/banner-hair.webp',
    'https://example.invalid/own.webp',
    null,
  ]);
  // カードの読み上げ名は見出しの文字（画像は飾り）
  expect(cards[0]).toHaveAccessibleName(/^春のヘアチェンジ特集/);
  expect(container.querySelectorAll('a[href^="/feature/"] svg')).toHaveLength(0);
});
