import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
jest.mock('react', () => ({ ...jest.requireActual('react'), use: (value: unknown) => value }));
const bookingId = '73000000-0000-4000-8000-000000000001';
const facilityId = '74000000-0000-4000-8000-000000000001';
const menuA = '75000000-0000-4000-8000-000000000001';
const menuB = '75000000-0000-4000-8000-000000000002';
const mockUser = jest.fn();
const mockQueries: { table: string; filters: unknown[][] }[] = [];
const mockResults: Record<string, unknown[]> = {};
function mockFrom(table: string) {
  const query = { table, filters: [] as unknown[][] }; mockQueries.push(query);
  const result = mockResults[table]?.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select','eq','in']) chain[method] = (...args: unknown[]) => { query.filters.push([method,...args]); return chain; };
  chain.single = chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockUser }, from: mockFrom }) }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message,type }: { message:string;type:string }) => <div role="status" data-kind={type}>{message}</div> }));
jest.mock('@/components/admin/AdjustRequestButtons', () => ({ __esModule: true, default: () => null }));
import Detail from '../page';
let fetchMock: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); mockQueries.length = 0;
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  mockUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockResults.bookings = [{ data: { facility_id: facilityId }, error: null }, { data: {
    id: bookingId, facility_id: facilityId, customer_name: '合成顧客', email: null,
    booking_date: '2026-10-01', start_time: '10:00', end_time: '11:00', status: 'pending',
    total_price: 100, menu_id: menuA, menu_ids: [menuB,menuA], staff_id: null,
  }, error: null }];
  mockResults.facility_members = [{ data: { facility_id: facilityId }, error: null }];
  mockResults.facility_menus = [{ data: [{ id: menuA, name: '施術A' },{ id: menuB,name: '施術B' }], error: null }];
  fetchMock = jest.fn(); global.fetch = fetchMock as typeof fetch;
});
function show() { render(<Detail params={{ id: bookingId } as unknown as Promise<{ id:string }>} />); }
test('locates exact tenant before customer fields; ordered all menus and return navigation stay scoped', async () => {
  show(); await screen.findByText('施術B、施術A');
  expect(mockQueries[1].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(mockQueries[1].filters).toContainEqual(['in','role',['owner','admin']]);
  expect(mockQueries[2].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(mockQueries[3].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === `/admin/bookings?facility_id=${facilityId}`)).toBe(true);
});
test('not a member never loads customer fields', async () => {
  mockResults.facility_members = [{ data: null, error: null }]; show(); await screen.findByText('予約が見つかりません');
  expect(mockQueries.filter(q => q.table === 'bookings')).toHaveLength(1);
});
test.each(['auth','target','membership','menus'])('dependency failure %s is not a missing reservation', async source => {
  if (source === 'auth') mockUser.mockResolvedValue({ data: { user: null }, error: { code:'08006' } });
  if (source === 'target') mockResults.bookings[0] = { data: null, error: { code:'08006' } };
  if (source === 'membership') mockResults.facility_members = [{ data: null, error: { code:'08006' } }];
  if (source === 'menus') mockResults.facility_menus = [{ data: null, error: { code:'08006' } }];
  show(); await screen.findByRole('alert'); expect(screen.queryByText('予約が見つかりません')).not.toBeInTheDocument();
});
test.each([null,{}, { success:false }])('HTTP 200 %j never becomes saved status', async data => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => data }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'承認する' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-kind','error'));
  expect(screen.getByRole('button',{ name:'承認する' })).toBeInTheDocument();
});
test('confirmed status without customer email does not claim delivery', async () => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ success:true }) }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'承認する' }));
  expect(await screen.findByRole('status')).toHaveTextContent('通知の配達完了を保証するものではありません');
  expect(screen.queryByRole('button',{ name:'承認する' })).not.toBeInTheDocument();
});
test.each([null,{}, { success:false,total_price:100 }, { success:true },
  { success:true,total_price:-1 }, { success:true,total_price:'100' }, { success:true,total_price:1.5 }])(
  'invalid checkout response %j never displays saved completion or fabricated zero', async data => {
    (mockResults.bookings[1] as { data:{ status:string } }).data.status = 'confirmed';
    fetchMock.mockResolvedValue({ ok:true,json:async () => data }); show();
    fireEvent.click(await screen.findByRole('button',{ name:'会計する' }));
    fireEvent.click(screen.getByRole('button',{ name:'会計を確定して完了' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-kind','error'));
    expect(screen.getByRole('button',{ name:'会計を確定して完了' })).toBeInTheDocument();
  });
test('checkout accepts a business-confirmed legitimate zero, not just HTTP 200', async () => {
  (mockResults.bookings[1] as { data:{ status:string } }).data.status = 'confirmed';
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ success:true,total_price:0 }) }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'会計する' }));
  fireEvent.click(screen.getByRole('button',{ name:'会計を確定して完了' }));
  expect(await screen.findByRole('status')).toHaveTextContent('¥0');
  expect(screen.getByRole('status')).toHaveAttribute('data-kind','success');
});
