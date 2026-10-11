import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminPhotosPage from '../page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
const photoId = '71000000-0000-4000-8000-000000000003';
let mockRequested: string | null = second;
let mockProfileRead = jest.fn();
const mockPhotoFilters = jest.fn();
const mockFetch = jest.fn();
const mockDb = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => ({ get: () => mockRequested }) }));
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string }) => <span>{props.alt}</span> }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockDb() }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));
jest.mock('@/components/ConfirmDialog', () => ({ __esModule: true, default: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => void; confirmLabel: string }) => open ? <button onClick={onConfirm}>{confirmLabel}</button> : null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRequested = second;
  mockProfileRead = jest.fn();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, photoId }) });
  global.fetch = mockFetch;
  mockDb.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) },
    from: (table: string) => {
      if (table === 'facility_members') {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
          limit: async () => ({ data: [{ facility_id: first, facility_profiles: { name: '合成店舗A' } },
            { facility_id: second, facility_profiles: { name: '合成店舗B' } }], error: null }) };
        return chain;
      }
      if (table === 'facility_profiles') { mockProfileRead(); throw new Error('browser profile writes forbidden'); }
      const chain = { select: () => chain, eq: (key: string, value: string) => { mockPhotoFilters(key, value); return chain; },
        order: () => chain, limit: async () => ({ error: null, data: [{ id: photoId, facility_id: second,
          photo_type: 'main', photo_url: 'https://example.invalid/synthetic.png', caption: '合成写真', sort_order: 0 }] }),
        delete: () => { throw new Error('Direct browser photo deletion forbidden'); } };
      return chain;
    },
  });
});

test('複数店舗は明示選択まで写真を読まず、指定店舗だけを編集する', async () => {
  mockRequested = null;
  const { rerender } = render(<AdminPhotosPage />);
  await screen.findByText('編集する店舗を選択してください');
  expect(mockPhotoFilters).not.toHaveBeenCalled();
  mockRequested = second;
  rerender(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  expect(mockPhotoFilters).toHaveBeenCalledWith('facility_id', second);
  expect(mockPhotoFilters).not.toHaveBeenCalledWith('facility_id', first);
});

test.each(['success', 'business-failure', 'http-failure', 'invalid-json', 'reject'])('メイン写真はserver経由で結果確認する：%s', async mode => {
  if (mode === 'reject') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic invalid JSON');
    return { ok: mode === 'success' };
  } });
  render(<AdminPhotosPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'メインに設定' }));
  await screen.findByText(mode === 'success' ? 'メイン写真を設定しました' : '設定を確認できませんでした。再読み込みして確認してください');
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/settings?facility_id=${second}&action=main-photo`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ photoId }) }));
  expect(mockProfileRead).not.toHaveBeenCalled();
});

test.each(['success', 'business-failure', 'wrong-id', 'http-failure', 'invalid-json', 'reject'])('写真削除はserverの確定結果まで成功表示しない：%s', async mode => {
  if (mode === 'reject') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic malformed JSON');
    return { ok: mode !== 'business-failure', photoId: mode === 'wrong-id' ? first : photoId };
  } });
  render(<AdminPhotosPage />);
  fireEvent.click(await screen.findByRole('button', { name: '掲載から外す' }));
  fireEvent.click(screen.getAllByRole('button', { name: '掲載から外す' })[1]);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(mode === 'success' ? '掲載写真を外しました' : '削除を確認できませんでした。再読み込みして確認してください'));
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/photos/${photoId}?facility_id=${second}`, { method: 'DELETE' });
  expect(mockPhotoFilters).not.toHaveBeenCalledWith('id', photoId);
  expect(mockPhotoFilters).toHaveBeenCalledWith('facility_id', second);
});
