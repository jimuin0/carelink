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
