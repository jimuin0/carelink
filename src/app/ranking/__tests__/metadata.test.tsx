/** @jest-environment node */
/**
 * 空のランキングは検索結果に出さない（2026年10月22日 是正）。
 *
 * ランキングは口コミのある施設だけを並べるため、口コミが集まるまでは必ず空になる。
 * 本番では /ranking（sitemap 掲載）と /ranking/東京都 が「まだ口コミが集まっていません」のまま
 * index 可だった。掲載 0 件ページを noindex にする規則をランキングにも適用する。
 * ただし読み取り失敗を「0 件」と取り違えて noindex を付けないこと（失敗は例外＝error.tsx）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import RankingPage, { generateMetadata as rankingMetadata } from '../page';
import AreaRankingPage, { generateMetadata as areaRankingMetadata } from '../[area]/page';
import { getRankedFacilities } from '@/lib/rankings';

jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('TEST_NOT_FOUND'); }) }));
jest.mock('@/lib/rankings', () => ({ getRankedFacilities: jest.fn() }));
jest.mock('@/components/search/FacilityCard', () => ({ __esModule: true, default: ({ facility }: { facility: { name: string } }) => <p>{facility.name}</p> }));

const facility = { id: 'f1', slug: 'hal', name: 'テスト施設', rating_avg: 4.5, rating_count: 2 };
const tokyo = encodeURIComponent('東京都');
const cases = [
  ['全国 /ranking', () => rankingMetadata(), () => RankingPage(), undefined],
  ['都道府県別 /ranking/東京都', () => areaRankingMetadata({ params: Promise.resolve({ area: tokyo }) }), () => AreaRankingPage({ params: Promise.resolve({ area: tokyo }) }), '東京都'],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  (getRankedFacilities as jest.Mock).mockResolvedValue([facility]);
});

describe.each(cases)('%s', (_label, metadata, page, area) => {
  test('ランキングが空なら noindex, follow（施設一覧への導線は辿らせる）', async () => {
    (getRankedFacilities as jest.Mock).mockResolvedValue([]);
    await expect(metadata()).resolves.toMatchObject({ robots: { index: false, follow: true } });
    expect(getRankedFacilities).toHaveBeenCalledWith(...(area ? [area] : []));
  });

  test('ランキングに施設があれば robots を出さない（index に戻る）', async () => {
    const result = await metadata();
    expect(result).not.toHaveProperty('robots');
    expect(result.alternates).toBeDefined();
  });

  test('読み取りに失敗したら noindex を付けず、空のランキングも出さず例外にする', async () => {
    (getRankedFacilities as jest.Mock).mockRejectedValue(new Error('RANKING_UNAVAILABLE'));
    await expect(metadata()).rejects.toThrow('RANKING_UNAVAILABLE');
    await expect(page()).rejects.toThrow('RANKING_UNAVAILABLE');
  });

  test('施設があればランキングに並べる', async () => {
    expect(renderToStaticMarkup(await page())).toContain('テスト施設');
  });
});

test('実在しない都道府県は件数を数えずに 404', async () => {
  await expect(areaRankingMetadata({ params: Promise.resolve({ area: 'does-not-exist' }) })).rejects.toThrow('TEST_NOT_FOUND');
  expect(getRankedFacilities).not.toHaveBeenCalled();
});
