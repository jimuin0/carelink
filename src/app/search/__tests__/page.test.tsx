/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { renderToStaticMarkup } from 'react-dom/server';
import SearchPage from '../page';
import { searchFacilities, getMonthlyBookingCounts, getAvailableFacilityIds, getFeaturedFacilities, getAvailableAreasAndTypes } from '@/lib/facilities';
jest.mock('@/lib/facilities', () => ({ searchFacilities: jest.fn(), getMonthlyBookingCounts: jest.fn(), getAvailableFacilityIds: jest.fn(), getFeaturedFacilities: jest.fn(), getAvailableAreasAndTypes: jest.fn() }));
jest.mock('@/components/search/SearchBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/search/Pagination', () => ({
  __esModule: true,
  default: ({ baseUrl }: { baseUrl: string }) => require('react').createElement('div', { 'data-pagination-base': baseUrl }),
}));
jest.mock('@/components/search/SearchFilters', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/search/MobileFilterButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/search/ViewToggle', () => ({ __esModule: true, default: () => null }));
beforeEach(() => {
  jest.clearAllMocks();
  (getFeaturedFacilities as jest.Mock).mockResolvedValue([]);
  (getAvailableAreasAndTypes as jest.Mock).mockResolvedValue({ areas: [], types: [] });
});
test.each([{ facilities: [] }, { facilities: [{ id: 'partial', name: 'partial result' }] }])('a failed search cannot render zero or partial successful results: %j', async ({ facilities }) => {
  (searchFacilities as jest.Mock).mockResolvedValue({ facilities, total: facilities.length, perPage: 20, error: { code: '08006', message: 'private database details' } });
  const page = SearchPage({ searchParams: Promise.resolve({ keyword: 'test', available_date: '2026-10-16' }) });
  await expect(page).rejects.toThrow('SEARCH_RESULTS_UNAVAILABLE');
  await expect(page).rejects.not.toThrow('private database details');
  expect(getFeaturedFacilities).not.toHaveBeenCalled();
  expect(getAvailableAreasAndTypes).not.toHaveBeenCalled();
  expect(getMonthlyBookingCounts).not.toHaveBeenCalled();
  expect(getAvailableFacilityIds).not.toHaveBeenCalled();
});
test('a genuinely empty successful read still renders search suggestions', async () => {
  (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: null });
  const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ keyword: 'test' }) }));
  expect(html.replace(/<[^>]*>/g, '')).toMatch(/0\s*件見つかりました/);
  expect(getAvailableAreasAndTypes).toHaveBeenCalledTimes(1);
});

// 【2026年10月22日 是正】絞り込みパネルは symptom / insurance を URL に書いていたのに、
// 検索ページが読まずに捨てていた（条件を選んでも結果が変わらなかった）。
describe('症状・保険適用の絞り込み', () => {
  const decode = (html: string) => html.replace(/&amp;/g, '&');
  const hrefs = (html: string) => [...decode(html).matchAll(/href="(\/search\?[^"]*)"/g)].map((m) => m[1]);
  const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

  beforeEach(() => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [{ id: 'a', name: 'A' }], total: 1, perPage: 20, error: null });
    (getMonthlyBookingCounts as jest.Mock).mockResolvedValue({});
  });

  test('symptom と insurance=1 を検索条件として渡す', async () => {
    await SearchPage({ searchParams: Promise.resolve({ symptom: '腰痛', insurance: '1' }) });
    expect(searchFacilities).toHaveBeenCalledWith(expect.objectContaining({ symptom: '腰痛', insurance: true }));
  });

  test('insurance が 1 以外なら保険適用で絞らない', async () => {
    await SearchPage({ searchParams: Promise.resolve({ insurance: 'yes' }) });
    expect(searchFacilities).toHaveBeenCalledWith(expect.objectContaining({ symptom: undefined, insurance: false }));
  });

  test('ページ送りと並び替えのリンクに症状・保険適用を引き継ぐ', async () => {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ symptom: '腰痛', insurance: '1', type: '鍼灸院・整骨院' }) }));
    const base = /data-pagination-base="([^"]*)"/.exec(decode(html));
    expect(base).not.toBeNull();
    expect(query(base![1]).get('symptom')).toBe('腰痛');
    expect(query(base![1]).get('insurance')).toBe('1');

    const sortLinks = hrefs(html).filter((h) => query(h).has('sort'));
    expect(sortLinks).toHaveLength(3);
    for (const link of sortLinks) {
      expect(query(link).get('symptom')).toBe('腰痛');
      expect(query(link).get('insurance')).toBe('1');
    }
  });

  test('症状・保険適用を指定していなければリンクに付けない', async () => {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ insurance: '0' }) }));
    const base = /data-pagination-base="([^"]*)"/.exec(decode(html));
    expect(query(base![1]).has('insurance')).toBe(false);
    for (const link of hrefs(html).filter((h) => query(h).has('sort'))) {
      expect(query(link).has('symptom')).toBe(false);
      expect(query(link).has('insurance')).toBe(false);
    }
  });

  test('適用中フィルター数に症状・保険適用を数える', async () => {
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ symptom: '腰痛', insurance: '1', price_max: '5000' }) }));
    expect(html.replace(/<[^>]*>/g, '')).toContain('(フィルター3件適用中)');
  });
});

// 【2026年10月22日 是正】結果より後ろのページ（本番の /search?page=2 で掲載 3 件）は 500 になっていた。
// 1 ページ目（page を外した同じ条件）へ戻す。
describe('結果より後ろのページ', () => {
  const redirected = async (searchParams: Record<string, string>) => {
    const err = await SearchPage({ searchParams: Promise.resolve(searchParams) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const digest = String((err as { digest?: string }).digest);
    expect(digest).toMatch(/^NEXT_REDIRECT;/);
    return digest.split(';')[2];
  };

  test('件数を超えたページは page を外した同じ条件へ戻す', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 3, perPage: 20, error: null });
    const to = await redirected({ type: '鍼灸院・整骨院', page: '2' });
    const query = new URLSearchParams(to.slice(to.indexOf('?') + 1));
    expect(query.get('type')).toBe('鍼灸院・整骨院');
    expect(query.has('page')).toBe(false);
    expect(getFeaturedFacilities).not.toHaveBeenCalled();
  });

  test('0 件で 2 ページ目を求めても 1 ページ目へ戻す（エラー画面にしない）', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: null });
    expect(await redirected({ page: '2' })).toBe('/search?');
  });

  test('範囲内のページは戻さない', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [{ id: 'a', name: 'A' }], total: 21, perPage: 20, error: null });
    (getMonthlyBookingCounts as jest.Mock).mockResolvedValue({});
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ page: '2' }) }));
    expect(html.replace(/<[^>]*>/g, '')).toMatch(/21\s*件見つかりました/);
  });
});

// 現在地検索のページ送りは位置を引き継ぐ（以前は lat/lng を落として 2 ページ目が全国の結果になった）。
test('現在地検索のページ送りに lat / lng を引き継ぐ', async () => {
  (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [{ id: 'a', name: 'A' }], total: 30, perPage: 20, error: null });
  (getMonthlyBookingCounts as jest.Mock).mockResolvedValue({});
  const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ lat: '34.78', lng: '135.47' }) }));
  const base = /data-pagination-base="([^"]*)"/.exec(html.replace(/&amp;/g, '&'));
  const query = new URLSearchParams(base![1].slice(base![1].indexOf('?') + 1));
  expect(query.get('lat')).toBe('34.78');
  expect(query.get('lng')).toBe('135.47');
});
