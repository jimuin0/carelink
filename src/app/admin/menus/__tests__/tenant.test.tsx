import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Page from '../page';
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
let requested: string | null;
const mockQuery = jest.fn();
const mockAuth = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(requested === null ? '' : `facility_id=${requested}`), useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockAuth }, from: mockQuery }) }));
const membershipRows = [{ facility_id: first, facility_profiles: { name: '合成店舗A' } }, { facility_id: second, facility_profiles: { name: '合成店舗B' } }];
let membershipError: unknown = null;
let menuError: unknown = null;
let menuDeferred: Promise<unknown> | null = null;
const scopes: string[] = [];
beforeEach(() => {
  requested = second; membershipError = menuError = null; menuDeferred = null; scopes.length = 0;
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockQuery.mockImplementation(table => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'limit']) q[method] = jest.fn(() => q);
    q.eq = jest.fn((column, value) => { if (table === 'facility_menus' && column === 'facility_id') scopes.push(value); return q; });
    q.order = jest.fn(() => table === 'facility_menus' ? menuDeferred ?? Promise.resolve({ data: [], error: menuError }) : q);
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: membershipRows, error: membershipError }).then(resolve);
    return q;
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});
test('second store is displayed and menu creation sends only selected ID', async () => {
  render(<Page />);
  await screen.findByRole('link', { name: '合成店舗B（選択中）' });
  expect(scopes).toEqual([second]);
  fireEvent.click(screen.getByRole('button', { name: 'メニュー追加' }));
  fireEvent.change(screen.getByLabelText(/メニュー名/), { target: { value: '合成メニュー' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(`/api/admin/menus?facility_id=${second}`, expect.objectContaining({ method: 'POST' })));
  expect(scopes.every(value => value === second)).toBe(true);
});
test('multiple stores with no selection require choice and expose no mutation', async () => {
  requested = null; render(<Page />);
  await screen.findByText('編集する店舗を選択してください');
  expect(scopes).toEqual([]);
  expect(screen.queryByRole('button', { name: 'メニュー追加' })).toBeNull();
});
test.each(['bad', '00000000-0000-4000-8000-000000000003'])('unauthorized selection never reads first store %s', async value => {
  requested = value; render(<Page />); await screen.findByRole('alert');
  expect(scopes).toEqual([]); expect(global.fetch).not.toHaveBeenCalled();
});
test('membership data plus error fails closed and retry restores selected store', async () => {
  membershipError = { code: '08006' }; render(<Page />); await screen.findByRole('alert');
  expect(scopes).toEqual([]);
  membershipError = null; fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await screen.findByRole('link', { name: '合成店舗B（選択中）' }); expect(scopes).toEqual([second]);
});
test('auth failure does not look like empty menus', async () => {
  mockAuth.mockResolvedValue({ data: { user: null }, error: { message: 'unavailable' } });
  render(<Page />); await screen.findByRole('alert'); expect(mockQuery).not.toHaveBeenCalled();
});
test('menu failure prevents mutation controls', async () => {
  menuError = { code: '08006' }; render(<Page />); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'メニュー追加' })).toBeNull();
});
test('URL store change remounts editor so old form cannot mutate new store', async () => {
  const { rerender } = render(<Page />); await screen.findByRole('button', { name: 'メニュー追加' });
  fireEvent.click(screen.getByRole('button', { name: 'メニュー追加' }));
  fireEvent.change(screen.getByLabelText(/メニュー名/), { target: { value: 'old form' } });
  requested = first; rerender(<Page />);
  await screen.findByRole('link', { name: '合成店舗A（選択中）' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(global.fetch).not.toHaveBeenCalled(); expect(scopes).toEqual([second, first]);
});
