import * as React from 'react';
import EditStaff from '../[id]/edit/page';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewStaff from '../new/page';
import Schedule from '../[id]/schedule/page';
const mockPush = jest.fn(); const mockSelection = jest.fn(); const mockGetUser = jest.fn(); const mockFrom = jest.fn();
const facility = '71000000-0000-4000-8000-000000000002';
const mockFetch = jest.fn();
let mockRequested = facility;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), useParams: () => ({ id: 'synthetic-staff' }), useSearchParams: () => new URLSearchParams(`facility_id=${mockRequested}`) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }) }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args) }));
jest.mock('@/components/admin/FacilitySelector', () => ({ __esModule: true, default: () => <p>店舗選択</p> }));
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: () => undefined }));
beforeEach(() => {
  jest.clearAllMocks(); mockRequested = facility; global.fetch = mockFetch;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '合成B' }], selectedId: facility });
});
test('new staff posts to selected B and returns to B', async () => {
  mockFetch.mockResolvedValue({ ok: true }); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff?facility_id=${facility}`, expect.objectContaining({ method: 'POST' })));
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'synthetic-owner', facility);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`));
});
test('new staff network failure retains form and reports failure', async () => {
  mockFetch.mockRejectedValue(new Error('synthetic failure')); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } }); fireEvent.click(screen.getByText('スタッフを追加'));
  await screen.findByText('通信エラーが発生しました'); expect(mockPush).not.toHaveBeenCalled(); expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe('合成スタッフ');
});
test('auth unavailable and membership failure never expose write form', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } }); const mounted = render(<NewStaff />);
  await screen.findByText(/利用権限を再確認/); expect(mockSelection).not.toHaveBeenCalled(); expect(screen.queryByText('スタッフを追加')).toBeNull(); mounted.unmount();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null }); mockSelection.mockRejectedValue(new Error('selection unavailable')); render(<NewStaff />);
  await screen.findByText(/店舗情報の取得に失敗/); expect(mockFetch).not.toHaveBeenCalled(); expect(screen.queryByText('スタッフを追加')).toBeNull();
});
test('schedule rejects staff from another tenant before loading shifts and back retains B', async () => {
  const eq = jest.fn(); const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, single: async () => ({ data: null, error: { code: 'PGRST116' } }) };
  mockFrom.mockReturnValue(chain); render(<Schedule />);
  await screen.findByText(/読み込みに失敗/); expect(eq).toHaveBeenCalledWith('facility_id', facility);
  expect(mockFrom).toHaveBeenCalledTimes(1); expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
  expect(screen.queryByText('スケジュールを保存')).toBeNull(); fireEvent.click(screen.getByText('← 戻る'));
  expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`); expect(mockFetch).not.toHaveBeenCalled();
});

test('changing facility remounts the new form and old selection cannot restore it', async () => {
  const mounted = render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '店舗Bの未保存スタッフ' } });
  const nextFacility = '71000000-0000-4000-8000-000000000003';
  let release: (value: unknown) => void = () => undefined;
  mockSelection.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mockRequested = nextFacility; mounted.rerender(<NewStaff />);
  await waitFor(() => expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'synthetic-owner', nextFacility));
  expect(screen.queryByLabelText(/名前/)).toBeNull();
  release({ choices: [{ id: nextFacility, name: '合成C' }], selectedId: nextFacility });
  expect((await screen.findByLabelText(/名前/ ) as HTMLInputElement).value).toBe('');
  expect(mockFetch).not.toHaveBeenCalled();
});
test('schedule DELETE network failure retains override and asks to recheck result', async () => {
  mockFrom.mockImplementation((table: string) => {
    const result = { data: table === 'staff_profiles' ? { name: '合成スタッフ' } : table === 'staff_schedules' ? [] : [{ id: 'synthetic-override', date: '2026-12-01', is_holiday: true, start_time: null, end_time: null }], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'order']) chain[method] = () => chain;
    chain.single = async () => result; chain.then = (resolve: (value: unknown) => unknown) => resolve(result); return chain;
  });
  mockFetch.mockRejectedValue(new Error('synthetic network outage')); render(<Schedule />);
  fireEvent.click(await screen.findByText('削除'));
  fireEvent.click(await screen.findByText('削除する'));
  await screen.findByText('通信エラーが発生しました。削除結果を再読み込みして確認してください');
  expect(screen.getByText('休み', { selector: 'span' })).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff/synthetic-staff/schedule?facility_id=${facility}`, expect.objectContaining({ method: 'DELETE' }));
});

test('edit rejects another tenant staff before menu reads and never exposes PATCH', async () => {
  const eq = jest.fn();
  const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, single: async () => ({ data: null, error: { code: 'PGRST116' } }) };
  mockFrom.mockReturnValue(chain);
  const params = Promise.resolve({ id: 'synthetic-staff' });
  await act(async () => { render(<React.Suspense fallback={<p>準備中</p>}><EditStaff params={params} /></React.Suspense>); });
    await screen.findByText('スタッフ情報の読み込みに失敗しました');
    expect(eq).toHaveBeenCalledWith('facility_id', facility);
    expect(mockFrom).toHaveBeenCalledTimes(1); expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
    expect(screen.queryByLabelText(/名前/)).toBeNull(); expect(mockFetch).not.toHaveBeenCalled();
});
test('completed POST from a departed store cannot navigate the new store form away', async () => {
  let releasePost: (value: unknown) => void = () => undefined;
  mockFetch.mockImplementation(() => new Promise(resolve => { releasePost = resolve; }));
  const mounted = render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '店舗Bのスタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加')); await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  mockRequested = '71000000-0000-4000-8000-000000000003';
  mockSelection.mockResolvedValue({ choices: [{ id: mockRequested, name: '合成C' }], selectedId: mockRequested });
  mounted.rerender(<NewStaff />); await screen.findByLabelText(/名前/);
  await act(async () => { releasePost({ ok: true }); });
  expect(mockPush).not.toHaveBeenCalled(); expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe('');
});
