import { render, screen, cleanup } from '@testing-library/react';
import Schedule from '../schedule/page';
import Bookings from '../bookings/page';
import Chain from '../chain/page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
const menuA = '72000000-0000-4000-8000-000000000001';
const menuB = '72000000-0000-4000-8000-000000000002';
const mockQueries: { table: string; filters: unknown[][] }[] = [];
const mockResults: Record<string, { data?: unknown; error?: unknown; count?: number }[]> = {};
const mockGrid = jest.fn(() => <div data-testid="grid" />);
const mockUser = jest.fn(async () => ({ data: { user: { id: 'synthetic-user' } } }));
const mockRpc = jest.fn();
function mockFrom(table: string) {
  const query = { table, filters: [] as unknown[][] };
  mockQueries.push(query);
  const result = mockResults[table]?.shift() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'gte', 'lte', 'ilike', 'range']) {
    chain[name] = (...args: unknown[]) => { query.filters.push([name, ...args]); return chain; };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({
  auth: { getUser: mockUser }, from: mockFrom,
}) }));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mockFrom, rpc: mockRpc }) }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); },
  redirect: () => { throw new Error('redirect'); }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/admin/BoardScheduleGrid', () => ({ __esModule: true, default: (props: unknown) => mockGrid(props) }));
jest.mock('../chain/BulkActions', () => ({ __esModule: true, default: () => null }));
const memberships = [{ facility_id: first, facility_profiles: { name: '合成店舗A' } },
  { facility_id: second, facility_profiles: { name: '合成店舗B' } }];
beforeEach(() => {
  jest.clearAllMocks(); mockQueries.length = 0;
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  mockResults.facility_members = [{ data: memberships, error: null }];
  mockRpc.mockResolvedValue({ data: [first, second].map(id => ({ id, booking_count: 0,
    monthly_bookings: 0, review_count: 0, rating_avg: 0, nps_score: null })), error: null });
});
afterEach(cleanup);

test.each([Schedule, Bookings])('複数店舗の未選択では予約を読まず選択画面を表示 %#', async page => {
  render(await page({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText('編集する店舗を選択してください')).toBeTruthy();
  expect(mockQueries.map(query => query.table)).toEqual(['facility_members']);
});
test.each([Schedule, Bookings])('未所属店舗を要求しても先頭店舗へフォールバックしない %#', async page => {
  await expect(page({ searchParams: Promise.resolve({ facility_id: '71000000-0000-4000-8000-000000000003' }) }))
    .rejects.toThrow('unauthorized_facility_selection');
  expect(mockQueries.map(query => query.table)).toEqual(['facility_members']);
});
test('予約表は選択店舗だけを読み、日送りと全メニューの順序を維持する', async () => {
  mockResults.facility_profiles = [{ data: null }];
  mockResults.staff_profiles = [{ data: [] }];
  mockResults.bookings = [{ data: [{ id: 'synthetic-booking', customer_name: '合成顧客',
    start_time: '10:00', end_time: '11:00', status: 'confirmed', staff_id: null,
    menu_id: menuA, menu_ids: [menuB, menuA] }] }];
  mockResults.facility_menus = [{ data: [{ id: menuA, name: '施術A', price: 100, duration_minutes: 30 },
    { id: menuB, name: '施術B', price: 100, duration_minutes: 30 }] }];
  render(await Schedule({ searchParams: Promise.resolve({ facility_id: second, date: '2026-10-01' }) }));
  expect(screen.getByRole('link', { name: '翌日' }).getAttribute('href')).toContain(`facility_id=${second}&date=2026-10-02`);
  expect(mockGrid).toHaveBeenCalledWith(expect.objectContaining({ facilityId: second,
    rows: expect.arrayContaining([expect.objectContaining({ chips: expect.arrayContaining([
      expect.objectContaining({ menuName: '施術B、施術A' }),
    ]) })]) }));
  for (const query of mockQueries.filter(q => ['bookings', 'facility_menus', 'staff_profiles'].includes(q.table))) {
    expect(query.filters).toContainEqual(['eq', 'facility_id', second]);
  }
});
test('一覧・詳細リンク・メニュー名の取得を同じ店舗へ固定する', async () => {
  mockResults.staff_profiles = [{ data: [] }];
  mockResults.bookings = [{ count: 1 }, { data: [{ id: 'synthetic-booking', booking_date: '2026-10-01',
    start_time: '10:00', end_time: '11:00', customer_name: '合成顧客', email: null, status: 'confirmed',
    total_price: 200, staff: null, menu_id: menuA, menu_ids: [menuB, menuA] }] }];
  mockResults.facility_menus = [{ data: [{ id: menuA, name: '施術A' }, { id: menuB, name: '施術B' }] }];
  render(await Bookings({ searchParams: Promise.resolve({ facility_id: second }) }));
  expect(screen.getByText('施術B、施術A')).toBeTruthy();
  expect(screen.getByRole('link', { name: /2026-10-01/ }).getAttribute('href'))
    .toBe(`/admin/bookings/synthetic-booking?facility_id=${second}`);
  expect(mockQueries.find(q => q.table === 'facility_menus')?.filters).toContainEqual(['eq', 'facility_id', second]);
});
test.each(['facility_members', 'facility_profiles'])('集計の依存失敗を0件にしない %s', async table => {
  mockResults[table] = [{ data: null, error: { code: '08006' } }];
  await expect(Chain()).rejects.toThrow();
});
test('DB内の集計RPC失敗を予約・口コミ・NPSの0件に置き換えない', async () => {
  mockResults.facility_profiles = [{ data: memberships.map(m => ({ id: m.facility_id, name: '合成店舗', slug: 'synthetic', status: 'draft' })) }];
  mockRpc.mockResolvedValue({ data: null, error: { code: '08006' } });
  await expect(Chain()).rejects.toThrow('店舗別集計の取得に失敗しました');
});
test('真の予約0件は集計でき、DB障害の表示と区別される', async () => {
  mockResults.facility_profiles = [{ data: memberships.map(m => ({ id: m.facility_id, name: '合成店舗', slug: 'synthetic', status: 'draft' })) }];
  render(await Chain());
  expect(screen.getByText('2施設の統合レポート')).toBeTruthy();
  expect(mockRpc).toHaveBeenCalledWith('get_chain_statistics', expect.objectContaining({ p_facility_ids: [first, second] }));
});
