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
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockFetch.mockImplementation((input: RequestInfo | URL) =>
    String(input).endsWith('/reply') ? response({ reply: null }) : response(),
  );
});

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

test('a ticket mutation refreshes the latest filter instead of its stale captured filter', async () => {
  const closedRow = { ...row, id: '22222222-2222-4222-8222-222222222222', name: 'クローズ済み問い合わせ', ticket_status: 'closed' };
  const pendingPatch = deferred<Response>();
  const firstClosedList = deferred<Response>();
  let closedListCalls = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/reply')) return Promise.resolve(response({ reply: null }));
    if (init?.method === 'PATCH') return pendingPatch.promise;
    if (url.includes('status=closed')) {
      closedListCalls += 1;
      return closedListCalls === 1
        ? firstClosedList.promise
        : Promise.resolve(response({ contacts: [closedRow], nextCursor: null }));
    }
    return Promise.resolve(response({ contacts: [row], nextCursor: null }));
  });

  render(<Page />);
  fireEvent.click(await screen.findByText('合成問い合わせ'));
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'resolved' } });
  fireEvent.click(screen.getByRole('button', { name: 'クローズ' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
    '/api/admin/inquiries?status=closed', expect.any(Object),
  ));

  // The mutation callback began before the filter changed. Its completion
  // must not issue a request with the old `open` filter.
  await act(async () => {
    pendingPatch.resolve(response({ ok: true }));
    await pendingPatch.promise;
  });
  await waitFor(() => expect(screen.getByText('クローズ済み問い合わせ')).toBeVisible());
  const listUrls = mockFetch.mock.calls.filter(([, init]) => init?.method !== 'PATCH').map(([url]) => url);
  expect(listUrls.filter((url) => url === '/api/admin/inquiries?status=open')).toHaveLength(1);
  expect(listUrls).toContain('/api/admin/inquiries?status=closed');

  await act(async () => {
    firstClosedList.resolve(response({ contacts: [], nextCursor: null }));
    await firstClosedList.promise;
  });
  await waitFor(() => expect(screen.getByText('クローズ済み問い合わせ')).toBeVisible());
});

test('a ticket mutation completing after unmount does not start a new PII list request', async () => {
  const pendingPatch = deferred<Response>();
  mockFetch.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
    String(_input).endsWith('/reply')
      ? Promise.resolve(response({ reply: null }))
      : init?.method === 'PATCH' ? pendingPatch.promise : Promise.resolve(response()),
  );

  const view = render(<Page />);
  fireEvent.click(await screen.findByText('合成問い合わせ'));
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'resolved' } });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  view.unmount();

  await act(async () => {
    pendingPatch.resolve(response({ ok: true }));
    await pendingPatch.promise;
  });
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

test('reload後に未確定の返信を復元し、同じoperation IDで再試行する', async () => {
  const pending = {
    operationId: '44444444-4444-4444-4444-444444444444',
    body: '保存済みの合成返信',
    sentAt: null,
    retryable: true,
  };
  let sent = false;
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/reply') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      expect(payload).toEqual({ body: pending.body, operationId: pending.operationId });
      sent = true;
      return Promise.resolve(response({ ok: true, alreadySent: false, warning: null }));
    }
    if (url.endsWith('/reply')) return Promise.resolve(response({
      reply: sent ? { ...pending, sentAt: '2026-09-27T00:00:00.000Z', retryable: false } : pending,
    }));
    return Promise.resolve(response());
  });

  render(<Page />);
  fireEvent.click(await screen.findByText('合成問い合わせ'));
  const textarea = await screen.findByLabelText('合成問い合わせ 様に返信');
  await waitFor(() => expect(textarea).toHaveValue(pending.body));
  expect(textarea).toBeDisabled();
  const send = screen.getByRole('button', { name: '返信を送信' });
  expect(send).toBeEnabled();
  fireEvent.click(send);
  expect(await screen.findByText('前回の返信（送信記録あり）')).toBeVisible();
  expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
});

test('返信状態取得に失敗した場合は送信操作を無効にする', async () => {
  mockFetch.mockImplementation((input: RequestInfo | URL) =>
    String(input).endsWith('/reply') ? response({ error: 'unknown' }, false) : response(),
  );
  render(<Page />);
  fireEvent.click(await screen.findByText('合成問い合わせ'));
  expect(await screen.findByRole('alert')).toHaveTextContent('送信状況を確認できません');
  expect(screen.getByRole('button', { name: '返信を送信' })).toBeDisabled();
});

test('予約前の失敗後に空の状態を再確認したら下書き編集ロックを解除する', async () => {
  jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('44444444-4444-4444-8444-444444444444');
  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/reply') && init?.method === 'POST') {
      return Promise.resolve(response({ error: 'rate limited' }, false));
    }
    return Promise.resolve(String(input).endsWith('/reply') ? response({ reply: null }) : response());
  });

  render(<Page />);
  fireEvent.click(await screen.findByText('合成問い合わせ'));
  const textarea = await screen.findByLabelText('合成問い合わせ 様に返信');
  fireEvent.change(textarea, { target: { value: '送信前の下書き' } });
  fireEvent.click(screen.getByRole('button', { name: '返信を送信' }));

  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
    `/api/admin/inquiries/${id}/reply`,
    expect.objectContaining({ method: 'POST' }),
  ));
  await waitFor(() => expect(textarea).toBeEnabled());
  expect(textarea).toHaveValue('送信前の下書き');
});
