/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../page';

const id = '11111111-1111-4111-8111-111111111111';
const row = {
  id, created_at: '2026-09-26T12:30:40.123456+00:00', name: '合成問い合わせ',
  email: 'synthetic@example.invalid', phone: null, inquiry_type: '施設掲載', message: '合成データです',
  ticket_status: 'open', priority: 'normal', ticket_notes: null, resolved_at: null, traffic_source: null,
};
const mockFetch = jest.fn();
function response(body: unknown = { contacts: [row], nextCursor: null }, ok = true) {
  return { ok, json: async () => body } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { jest.clearAllMocks(); global.fetch = mockFetch; mockFetch.mockResolvedValue(response()); });

test('loads through the guarded API and reports only the visible-page count', async () => {
  render(<Page />);
  expect(await screen.findByText('合成問い合わせ')).toBeVisible();
  expect(screen.getByText('このページに1件の新着問い合わせ')).toBeVisible();
  expect(mockFetch).toHaveBeenCalledWith('/api/admin/inquiries?status=open', expect.objectContaining({
    cache: 'no-store',
    signal: expect.any(AbortSignal),
  }));
});

test('paginates with the opaque timestamp cursor and preserves existing rows', async () => {
  const cursor = { id, createdAt: row.created_at };
  mockFetch.mockResolvedValueOnce(response({ contacts: [row], nextCursor: cursor }))
    .mockResolvedValueOnce(response({ contacts: [{ ...row, id: '22222222-2222-4222-8222-222222222222', name: '次の問い合わせ' }], nextCursor: null }));
  render(<Page />);
  expect(await screen.findByText('合成問い合わせ')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  expect(await screen.findByText('次の問い合わせ')).toBeVisible();
  const [url] = mockFetch.mock.calls[1];
  expect(JSON.parse(new URL(url, 'http://localhost').searchParams.get('cursor')!)).toEqual(cursor);
  expect(screen.getByText('合成問い合わせ')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'さらに読み込む' })).not.toBeInTheDocument();
});

test.each(['http', 'shape', 'reject'])('%s failure is visible and retry can recover', async mode => {
  if (mode === 'http') mockFetch.mockResolvedValueOnce(response({}, false));
  if (mode === 'shape') mockFetch.mockResolvedValueOnce(response({}));
  if (mode === 'reject') mockFetch.mockRejectedValueOnce(new Error('network'));
  render(<Page />);
  expect(await screen.findByRole('alert')).toHaveTextContent('問い合わせの読み込みに失敗しました');
  expect(screen.queryByText('問い合わせがありません')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByText('合成問い合わせ')).toBeVisible();
});

test('status filter refetches without stale results; failed pagination keeps retry control', async () => {
  render(<Page />);
  expect(await screen.findByText('合成問い合わせ')).toBeVisible();
  mockFetch.mockResolvedValueOnce(response({ contacts: [row], nextCursor: { id, createdAt: row.created_at } }))
    .mockRejectedValueOnce(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  expect(mockFetch.mock.calls[1][0]).toBe('/api/admin/inquiries?status=all');
  expect(await screen.findByRole('button', { name: 'さらに読み込む' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  expect(await screen.findByText('続きの読み込みに失敗しました。再試行してください')).toBeVisible();
  expect(screen.getByText('合成問い合わせ')).toBeVisible();
  expect(screen.getByRole('button', { name: 'さらに読み込む' })).toBeEnabled();
});

test('ignores an older pagination response after a newer filter request completes', async () => {
  const openCursor = { id, createdAt: row.created_at };
  const filteredCursor = { id: '22222222-2222-4222-8222-222222222222', createdAt: row.created_at };
  const oldPage = deferred<Response>();
  const filteredPage = deferred<Response>();
  const finalPage = deferred<Response>();
  mockFetch.mockResolvedValueOnce(response({ contacts: [row], nextCursor: openCursor }));
  mockFetch.mockReturnValueOnce(oldPage.promise);
  mockFetch.mockReturnValueOnce(filteredPage.promise);
  mockFetch.mockReturnValueOnce(finalPage.promise);

  render(<Page />);
  expect(await screen.findByText('合成問い合わせ')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  const oldPageSignal = mockFetch.mock.calls[1][1].signal as AbortSignal;

  fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  expect(oldPageSignal.aborted).toBe(true);
  filteredPage.resolve(response({
    contacts: [{ ...row, id: filteredCursor.id, name: '新しいフィルター結果', ticket_status: 'closed' }],
    nextCursor: filteredCursor,
  }));
  expect(await screen.findByText('新しいフィルター結果')).toBeVisible();

  oldPage.resolve(response({
    contacts: [{ ...row, id: '33333333-3333-4333-8333-333333333333', name: '古いページ結果' }],
    nextCursor: { id: '33333333-3333-4333-8333-333333333333', createdAt: row.created_at },
  }));
  await waitFor(() => expect(screen.queryByText('古いページ結果')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  const [nextUrl] = mockFetch.mock.calls[3];
  expect(JSON.parse(new URL(nextUrl, 'http://localhost').searchParams.get('cursor')!)).toEqual(filteredCursor);
  await act(async () => {
    finalPage.resolve(response({ contacts: [], nextCursor: null }));
    await finalPage.promise;
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'さらに読み込む' })).not.toBeInTheDocument());
});
