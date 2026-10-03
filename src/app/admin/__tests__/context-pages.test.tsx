/** @jest-environment node */
import Dashboard from '../page';
import Staff from '../staff/page';
import Analytics from '../analytics/page';
import type { ReactElement } from 'react';
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockSelection = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser }, from: mockFrom }) }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args) }));
jest.mock('@/components/admin/FacilitySelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/DynamicAnalyticsCharts', () => ({ RevenueChart: () => null, BookingTrendChart: () => null, CustomerSegmentChart: () => null, RepeatRateCard: () => null, ViewCountCard: () => null }));
jest.mock('../analytics/StaffSalesTab', () => ({ __esModule: true, default: () => null }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
const facility = '71000000-0000-4000-8000-000000000002';
const queries: { table: string; eq: jest.Mock }[] = [];
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...nodes(el.props.children), ...nodes(el.props.actions), ...nodes(el.props.action)];
}
beforeEach(() => {
  queries.length = 0; jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '店舗B' }], selectedId: facility });
  mockFrom.mockImplementation((table: string) => {
    const result = { data: table === 'facility_profiles' ? { status: 'draft' } : table === 'staff_profiles' ? [{ id: 'staff-b', name: '合成スタッフ', is_active: true }] : [], count: 0, error: null };
    const c: Record<string, unknown> = {}; const eq = jest.fn(() => c); queries.push({ table, eq }); c.eq = eq;
    for (const method of ['select', 'or', 'in', 'order', 'limit', 'gte', 'lte', 'neq']) c[method] = () => c;
    c.single = () => Promise.resolve(result); c.then = (resolve: (result: unknown) => unknown) => resolve(result); return c;
  });
});
const pages = [Dashboard, Staff, Analytics];
test.each(pages)('%p never reads business data before an explicit multi-store selection', async page => {
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '店舗B' }], selectedId: null });
  await page({ searchParams: Promise.resolve({}) }); expect(mockFrom).not.toHaveBeenCalled();
});
test.each(pages)('%p treats Auth outage as unavailable without tenant reads', async page => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
  const tree = await page({ searchParams: Promise.resolve({}) }); expect(nodes(tree).length).toBeGreaterThan(0);
  expect(mockSelection).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled();
});
test.each(pages)('%p rejects unauthorized tenant/selection outage before queries', async page => {
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  await expect(page({ searchParams: Promise.resolve({ facility_id: facility }) })).rejects.toThrow('unauthorized');
  expect(mockFrom).not.toHaveBeenCalled();
});
test('dashboard links retain selected store and today uses from/to', async () => {
  const tree = await Dashboard({ searchParams: Promise.resolve({ facility_id: facility }) });
  const links = nodes(tree).map(n => n.props.href).filter((href): href is string => typeof href === 'string');
  expect(links.length).toBeGreaterThan(20);
  expect(links.every(href => new URL(href, 'http://synthetic').searchParams.get('facility_id') === facility)).toBe(true);
  const today = links.filter(href => href.startsWith('/admin/bookings?from=')); expect(today).toHaveLength(2);
  const params = new URL(today[0], 'http://synthetic').searchParams;
  expect(params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(params.get('to')).toBe(params.get('from')); expect(params.has('date')).toBe(false);
});
test('staff list scopes reads and new/edit/schedule links to B', async () => {
  const tree = await Staff({ searchParams: Promise.resolve({ facility_id: facility }) });
  expect(queries.find(q => q.table === 'staff_profiles')?.eq).toHaveBeenCalledWith('facility_id', facility);
  const links = nodes(tree).map(n => n.props.href).filter((href): href is string => typeof href === 'string');
  expect(links).toContain(`/admin/staff/new?facility_id=${facility}`);
  expect(links).toContain(`/admin/staff/staff-b/edit?facility_id=${facility}`);
  expect(links).toContain(`/admin/staff/staff-b/schedule?facility_id=${facility}`);
});
test('analytics all six months query selected B', async () => {
  await Analytics({ searchParams: Promise.resolve({ facility_id: facility }) });
  expect(queries).toHaveLength(6); for (const q of queries) expect(q.eq).toHaveBeenCalledWith('facility_id', facility);
});

test('analytics children remount on store changes so previous tenant data cannot remain', async () => {
  const tree = await Analytics({ searchParams: Promise.resolve({ facility_id: facility }) });
  const charts = nodes(tree).filter(node => node.props.facilityId === facility);
  expect(charts).toHaveLength(6); for (const chart of charts) expect(chart.key).toBe(facility);
});
