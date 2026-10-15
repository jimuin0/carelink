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
  global.fetch = jest.fn().mockImplementation((url, options) => {
    if (!options?.method) { scopes.push(new URL(url,'https://example.invalid').searchParams.get('facility_id')!);
      return menuDeferred ?? Promise.resolve({ok:!menuError,json:async()=>({menus:[],revision:null})}); }
    return Promise.resolve({ok:true,json:async()=>({})});
  });
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
  expect(screen.queryByRole('dialog')).toBeNull(); expect((global.fetch as jest.Mock).mock.calls.filter(([,options])=>options?.method)).toEqual([]); expect(scopes).toEqual([second, first]);
});

test('retry after menu outage hides old controls until identity and store are reverified', async () => {
  menuError = { code: '08006' };
  render(<Page />); await screen.findByRole('alert');
  let finishAuth!: (value: unknown) => void;
  mockAuth.mockReturnValue(new Promise(resolve => { finishAuth = resolve; }));
  menuError = null;
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await waitFor(() => expect(mockAuth).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'メニュー追加' })).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls.filter(([,options])=>options?.method)).toEqual([]);
  finishAuth({ data: { user: { id: 'synthetic-user' } }, error: null });
  await screen.findByRole('link', { name: '合成店舗B（選択中）' });
  expect(screen.getByRole('button', { name: 'メニュー追加' })).toBeTruthy();
});


const menuA='00000000-0000-4000-8000-000000000010'; const menuB='00000000-0000-4000-8000-000000000020';
const orderRevision='2026-10-15T01:00:00.000Z';
function orderedSnapshot() { return {menus:[{id:menuA,facility_id:second,name:'A',category:'カット',sort_order:0,price:1000},{id:menuB,facility_id:second,name:'B',category:'カット',sort_order:0,price:2000}],revision:orderRevision}; }
test('reordering sends one category transaction with the selected store and original revision',async()=>{
 (global.fetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>orderedSnapshot()});render(<Page/>);await screen.findByText('A');
 fireEvent.click(screen.getAllByRole('button',{name:'下へ'})[0]);
 await waitFor(()=>expect((global.fetch as jest.Mock).mock.calls.some(([url])=>url.includes('/reorder?'))).toBe(true));
 const mutations=(global.fetch as jest.Mock).mock.calls.filter(([,options])=>options?.method);
 expect(mutations).toHaveLength(1);expect(mutations[0][0]).toBe(`/api/admin/menus/reorder?facility_id=${second}`);
 expect(JSON.parse(mutations[0][1].body)).toEqual({menu_ids:[menuB,menuA],expected_ids:[menuA,menuB],expected_revision:orderRevision});
});
test.each(['lost-response','conflict'])('reorder %s reloads authoritative result without another mutation',async mode=>{
 (global.fetch as jest.Mock).mockImplementation((_url,options)=>{
  if(options?.method) return mode==='lost-response'?Promise.reject(new Error('network')):Promise.resolve({ok:false,json:async()=>({error:'一覧が更新されています'})});
  return Promise.resolve({ok:true,json:async()=>orderedSnapshot()});
 });render(<Page/>);await screen.findByText('A');fireEvent.click(screen.getAllByRole('button',{name:'下へ'})[0]);
 await waitFor(()=>expect((global.fetch as jest.Mock).mock.calls.filter(([,options])=>!options?.method)).toHaveLength(2));
 expect((global.fetch as jest.Mock).mock.calls.filter(([,options])=>options?.method)).toHaveLength(1);
});
