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
let profileRow: Record<string, unknown> = { status: 'draft' };
beforeEach(() => {
  queries.length = 0; jest.clearAllMocks(); profileRow = { status: 'draft' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '店舗B' }], selectedId: facility });
  mockFrom.mockImplementation((table: string) => {
    const result = { data: table === 'facility_profiles' ? profileRow : table === 'staff_profiles' ? [{ id: 'staff-b', name: '合成スタッフ', is_active: true }] : [], count: 0, error: null };
    const c: Record<string, unknown> = {}; const eq = jest.fn(() => c); queries.push({ table, eq }); c.eq = eq;
    for (const method of ['select', 'or', 'in', 'order', 'limit', 'gte', 'lte', 'neq', 'not']) c[method] = () => c;
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
  // 公開中の店舗（公開前で予約の無い店舗は、空の売上・2週間表を出さずセットアップを先に見せる）
  profileRow = { status: 'published' };
  const tree = await Dashboard({ searchParams: Promise.resolve({ facility_id: facility }) });
  const links = nodes(tree).map(n => n.props.href).filter((href): href is string => typeof href === 'string');
  expect(links.length).toBeGreaterThan(20);
  expect(links.filter(href => href.startsWith('/admin')).every(href => new URL(href, 'http://synthetic').searchParams.get('facility_id') === facility)).toBe(true);
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
// E8: 追加しただけのスタッフには勤務が無い（予約枠が出ない）。一覧で示し、勤務の画面へ導く。
// 勤務の有無は予約枠と同じ規則（週間の勤務日か、今日以降に勤務する特別日）で決める。
test('staff list marks active staff without working time as unable to take bookings', async () => {
  const staff = [
    { id: 'staff-saved', name: '保存済み', is_active: true }, { id: 'staff-new', name: '追加直後', is_active: true },
    { id: 'staff-special', name: '特別日だけ', is_active: true }, { id: 'staff-paused', name: '休止中', is_active: false },
  ];
  // 在籍スタッフの勤務の有無（workingStaffQuery の応答）。
  const working = [
    { id: 'staff-saved', staff_schedules: [{ day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' }], schedule_overrides: [] },
    { id: 'staff-new', staff_schedules: [], schedule_overrides: [] },
    { id: 'staff-special', staff_schedules: [], schedule_overrides: [{ date: '2030-01-07', start_time: '10:00:00', end_time: '12:00:00' }] },
  ];
  const selects: string[] = [];
  mockFrom.mockImplementation((table: string) => {
    const c: Record<string, unknown> = {}; let columns = '';
    const eq = jest.fn(() => c); queries.push({ table, eq }); c.eq = eq;
    c.select = (cols: string) => { columns = cols; selects.push(cols); return c; };
    for (const method of ['order', 'gte', 'not', 'limit', 'or']) c[method] = () => c;
    c.then = (resolve: (r: unknown) => unknown) => resolve({ data: table !== 'staff_profiles' ? [] : columns.includes('staff_schedules(') ? working : staff, error: null });
    return c;
  });
  const tree = await Staff({ searchParams: Promise.resolve({ facility_id: facility }) });
  // 勤務を読むのは、この店舗の在籍スタッフだけ（予約枠・検索カードと同じ読み方）
  expect(selects).toContain('id, staff_schedules(day_of_week, start_time, end_time), schedule_overrides(date, start_time, end_time)');
  const workingRead = queries.filter(q => q.table === 'staff_profiles').find(q => q.eq.mock.calls.some(([column]) => column === 'is_active'));
  expect(workingRead?.eq.mock.calls).toEqual([['facility_id', facility], ['is_active', true]]);
  const card = (id: string) => nodes(tree).find(n => n.key === id) as ReactElement<Record<string, unknown>>;
  const text = (el: unknown): string => nodes(el).flatMap(n => [n.props.children].flat()).filter((c): c is string => typeof c === 'string').join('');
  expect(text(card('staff-new'))).toContain('勤務時間が未登録です。');
  // サロンボードの「指名なし」も勤務時間のあるスタッフにしか割り当てない（20261023130100）ことも伝える
  expect(text(card('staff-new'))).toContain('保存するまで、このスタッフはネット予約を受けられず、予約表の「指名なし」の予約にも割り当てられません。');
  expect(nodes(card('staff-new')).find(n => n.props.children === '勤務時間を登録する')?.props.href).toBe(`/admin/staff/staff-new/schedule?facility_id=${facility}`);
  expect(text(card('staff-saved'))).not.toContain('勤務時間が未登録です。');
  // 特別日だけ勤務する人は、その日に予約を受けられる（「未登録」と言わない）
  expect(text(card('staff-special'))).not.toContain('勤務時間が未登録です。');
  expect(text(card('staff-paused'))).not.toContain('勤務時間が未登録です。');
});

test('staff list schedule read failure is not shown as "未登録"', async () => {
  mockFrom.mockImplementation(() => {
    const c: Record<string, unknown> = {}; let columns = '';
    c.select = (cols: string) => { columns = cols; return c; };
    for (const method of ['eq', 'order', 'gte', 'not', 'limit', 'or']) c[method] = () => c;
    c.then = (resolve: (r: unknown) => unknown) => resolve(columns.includes('staff_schedules(')
      ? { data: null, error: { message: 'synthetic outage' } }
      : { data: [{ id: 'staff-b', name: '合成スタッフ', is_active: true }], error: null });
    return c;
  });
  await expect(Staff({ searchParams: Promise.resolve({ facility_id: facility }) })).rejects.toThrow('スタッフの勤務状況を取得できませんでした: synthetic outage');
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
