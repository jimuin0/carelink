/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '../page';
import { notFound } from 'next/navigation';
import { getAreaBySlug, getAreaBreadcrumb, getAreasByParent, buildAreaSearchParam } from '@/lib/areas';
import { searchAreaFacilities } from '@/lib/area-facilities';

jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NOT_FOUND'); }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
jest.mock('@/lib/areas', () => ({ getAreaBySlug: jest.fn(), getAreaBreadcrumb: jest.fn(), getAreasByParent: jest.fn(), buildAreaSearchParam: jest.fn() }));
jest.mock('@/lib/area-facilities', () => ({ searchAreaFacilities: jest.fn() }));
jest.mock('@/components/search/FacilityCard', () => ({ __esModule: true, default: ({ facility }: { facility: { name: string } }) => <div>{facility.name}</div> }));
jest.mock('@/components/search/Pagination', () => ({ __esModule: true, default: ({ currentPage, totalPages }: { currentPage: number; totalPages: number }) => <div>{`page ${currentPage}/${totalPages}`}</div> }));

const region = { id: 'r', slug: 'kinki', name: '近畿', parent_id: null, area_type: 'region', sort_order: 1 };
const pref = { id: 'p', slug: 'osaka', name: '大阪府', parent_id: 'r', area_type: 'prefecture', sort_order: 1 };
const city = { id: 'c', slug: 'toy', name: '豊中市', parent_id: 'p', area_type: 'city', sort_order: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  (getAreaBySlug as jest.Mock).mockResolvedValue(city);
  (getAreaBreadcrumb as jest.Mock).mockResolvedValue([region, pref, city]);
  (getAreasByParent as jest.Mock).mockResolvedValue([]);
  (buildAreaSearchParam as jest.Mock).mockReturnValue({ kind: 'city', prefecture: '大阪府', city: '豊中市' });
  (searchAreaFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20 });
});

test('uses ancestry-scoped search; only a genuinely empty query says there are no listings', async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({}) }));
  expect(buildAreaSearchParam).toHaveBeenCalledWith(city, [region, pref, city], []);
  expect(searchAreaFacilities).toHaveBeenCalledWith({ kind: 'city', prefecture: '大阪府', city: '豊中市' }, 1);
  expect(html).toContain('このエリアにはまだサロン・クリニックが登録されていません');
});

test('empty regions explain that their child-area list is not prepared', async () => {
  (getAreaBySlug as jest.Mock).mockResolvedValue(region);
  (getAreaBreadcrumb as jest.Mock).mockResolvedValue([region]);
  (buildAreaSearchParam as jest.Mock).mockReturnValue({ kind: 'region', prefectures: [] });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: 'kinki' }), searchParams: Promise.resolve({}) }));
  expect(searchAreaFacilities).toHaveBeenCalledWith({ kind: 'region', prefectures: [] }, 1);
  expect(html).toContain('下位エリアの登録準備中です');
  expect(html).not.toContain('全国');
});

test('page values are strictly validated and out-of-range result pages keep a path back', async () => {
  (searchAreaFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 21, perPage: 20 });
  const pageHtml = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({ page: '2' }) }));
  expect(searchAreaFacilities).toHaveBeenCalledWith(expect.anything(), 2);
  expect(pageHtml).toContain('page 2/2');
  for (const page of ['0', '-1', '1.5', 'abc', '100001', ['1', '2']]) {
    await expect(Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({ page }) })).rejects.toThrow('NOT_FOUND');
  }
  expect(searchAreaFacilities).toHaveBeenCalledTimes(1);
  await expect(Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({ page: '100000' }) })).resolves.toBeTruthy();
  expect(searchAreaFacilities).toHaveBeenLastCalledWith(expect.anything(), 100000);
});

test('only a missing slug is a 404; area lookup failure propagates', async () => {
  (getAreaBySlug as jest.Mock).mockResolvedValue(null);
  await expect(Page({ params: Promise.resolve({ slug: 'missing' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
  expect(notFound).toHaveBeenCalledTimes(1);
  (getAreaBySlug as jest.Mock).mockRejectedValue(new Error('Area lookup unavailable'));
  await expect(Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({}) })).rejects.toThrow('Area lookup unavailable');
  expect(notFound).toHaveBeenCalledTimes(1);
});

test('facility query failure propagates instead of rendering an empty area', async () => {
  (searchAreaFacilities as jest.Mock).mockRejectedValue(new Error('Area facilities unavailable'));
  await expect(Page({ params: Promise.resolve({ slug: 'toy' }), searchParams: Promise.resolve({}) })).rejects.toThrow('Area facilities unavailable');
});
