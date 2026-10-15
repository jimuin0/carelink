/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { renderToStaticMarkup } from 'react-dom/server';
import SearchPage from '../page';
import { searchFacilities, getMonthlyBookingCounts, getAvailableFacilityIds, getFeaturedFacilities, getAvailableAreasAndTypes } from '@/lib/facilities';
jest.mock('@/lib/facilities', () => ({ searchFacilities: jest.fn(), getMonthlyBookingCounts: jest.fn(), getAvailableFacilityIds: jest.fn(), getFeaturedFacilities: jest.fn(), getAvailableAreasAndTypes: jest.fn() }));
jest.mock('@/components/search/SearchBar', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/search/Pagination', () => ({ __esModule: true, default: () => null }));
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
