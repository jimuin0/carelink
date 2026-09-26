/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../page';
const id = '74000000-0000-4000-8000-000000000001';
const time = '2026-09-26T12:30:40.123456+00:00';
const row = { id, name: '合成施設', email: 'synthetic@example.invalid', phone: null,
  status: 'pending', created_at: time, claimed_at: null, claimed_facility_id: null, review_revision: 0 };
const cursor = { id, createdAt: time };
const mockFetch = jest.fn();
function response(body: unknown = { salons: [row], nextCursor: null }, ok = true) {
  return { ok, json: async () => body } as Response;
}
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { jest.clearAllMocks(); global.fetch = mockFetch; mockFetch.mockResolvedValue(response()); });
afterEach(() => { jest.useRealTimers(); });
test('receipt and creation status are distinct from approval/publication; search never enters URL', async () => {
  render(<Page />);
  expect(await screen.findByText('合成施設')).toBeVisible();
  expect(screen.getByText(`受付番号：${id}`)).toBeVisible();
  expect(screen.getByText('店舗作成前')).toBeVisible();
  expect(screen.getByText(/審査の承認は一般公開の完了ではありません/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('検索項目'), { target: { value: 'email' } });
  fireEvent.change(screen.getByLabelText('検索値'), { target: { value: ' Synthetic.Name+tag@GoogleMail.com ' } });
  fireEvent.change(screen.getByLabelText('審査状態'), { target: { value: 'approved' } });
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  const [url, options] = mockFetch.mock.calls[1];
  expect(url).toBe('/api/admin/registrations');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ field: 'email', query: 'Synthetic.Name+tag@GoogleMail.com', status: 'approved', cursor: null });
});
test('invalid receipt never issues a search', async () => {
  render(<Page />); await screen.findByText('合成施設');
  fireEvent.change(screen.getByLabelText('検索項目'), { target: { value: 'receipt' } });
  fireEvent.change(screen.getByLabelText('検索値'), { target: { value: 'bad' } });
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  expect(screen.getByRole('alert')).toHaveTextContent('検索条件を確認');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
test('next/previous pagination preserves microseconds; new search resets cursor/history', async () => {
  mockFetch.mockResolvedValue(response({ salons: [row], nextCursor: cursor }));
  render(<Page />); await screen.findByText('合成施設');
  fireEvent.click(screen.getByRole('button', { name: '次の50件' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mockFetch.mock.calls[1][1].body).cursor).toEqual(cursor);
  await waitFor(() => expect(screen.getByRole('button', { name: '前の50件' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '前の50件' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(mockFetch.mock.calls[2][1].body).cursor).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: '次の50件' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '次の50件' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
  expect(JSON.parse(mockFetch.mock.calls[4][1].body).cursor).toBeNull();
  expect(screen.getByText('1ページ目')).toBeVisible();
});
test.each(['http', 'shape', 'json', 'reject'])('%s failure is not an empty listing and retry recovers', async mode => {
  if (mode === 'http') mockFetch.mockResolvedValueOnce(response({ salons: [], nextCursor: null }, false));
  if (mode === 'shape') mockFetch.mockResolvedValueOnce(response({ salons: [] }));
  if (mode === 'json') mockFetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad JSON'); } });
  if (mode === 'reject') mockFetch.mockRejectedValueOnce(new Error('network'));
  render(<Page />);
  expect(await screen.findByRole('alert')).toHaveTextContent('申込なしとは判定できません');
  expect(screen.queryByText(/該当する登録申請はありません/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByText('合成施設')).toBeVisible();
});
test('only a verified empty response shows condition-scoped absence', async () => {
  mockFetch.mockResolvedValue(response({ salons: [], nextCursor: null })); render(<Page />);
  expect(await screen.findByText('この条件・ページに該当する登録申請はありません')).toBeVisible();
});
test.each(['success', 'failure'])('superseded request %s cannot overwrite current data/error/loading/cursor', async outcome => {
  const old = deferred(); const current = deferred();
  mockFetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<Page />);
  fireEvent.change(screen.getByLabelText('検索値'), { target: { value: '新条件' } });
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  await act(async () => { current.resolve(response({ salons: [{ ...row, name: '新結果' }], nextCursor: null })); });
  expect(screen.getByText('新結果')).toBeVisible();
  await act(async () => {
    if (outcome === 'success') old.resolve(response({ salons: [{ ...row, name: '古い結果' }], nextCursor: cursor }));
    else old.reject(new Error('old failure'));
  });
  expect(screen.getByText('新結果')).toBeVisible();
  expect(screen.queryByText('古い結果')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '次の50件' })).toBeDisabled();
});
test('changing applied conditions closes a stale rejection dialog', async () => {
  render(<Page />); await screen.findByText('合成施設');
  fireEvent.click(screen.getByRole('button', { name: '却下', exact: true }));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockFetch.mock.calls.some(([, options]) => options.method === 'PATCH')).toBe(false);
});
test('mutation serializes clicks and search, checks business success then reloads', async () => {
  const patch = deferred();
  mockFetch.mockResolvedValueOnce(response()).mockReturnValueOnce(patch.promise).mockResolvedValue(response({ salons: [{ ...row, status: 'approved' }], nextCursor: null }));
  render(<Page />); await screen.findByText('合成施設');
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  expect(screen.getByRole('button', { name: '検索する' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '一覧を再読み込み' })).toBeDisabled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  await act(async () => { patch.resolve(response({ success: true })); });
  expect(await screen.findByText('承認済', { selector: 'span' })).toBeVisible();
  expect(screen.getByRole('button', { name: '検索する' })).toBeEnabled();
  expect(mockFetch.mock.calls[1][0]).toBe(`/api/admin/registrations/${id}`);
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ status: 'approved', expected_status: 'pending', expected_revision: 0 });
});
test.each(['business', 'http', 'throw'])('mutation %s failure is ambiguous, not success or an automatic retry', async mode => {
  mockFetch.mockResolvedValueOnce(response());
  if (mode === 'throw') mockFetch.mockRejectedValueOnce(new Error('network'));
  else mockFetch.mockResolvedValueOnce(response({ success: mode === 'http' }, mode !== 'http'));
  render(<Page />); await screen.findByText('合成施設');
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  expect(await screen.findByText(/結果を確認できませんでした/)).toBeVisible();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('合成施設を承認しました')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '承認', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: '却下', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  expect(mockFetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '一覧を再読み込み' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '承認', exact: true })).toBeEnabled());
});
test('legacy NULL date/status and claimed records have explicit labels', async () => {
  mockFetch.mockResolvedValue(response({ salons: [{ ...row, status: null, created_at: null, claimed_at: time }], nextCursor: null }));
  const view = render(<Page />);
  expect(await screen.findByText('受付日時未設定')).toBeVisible();
  expect(screen.getByText('状態未設定', { selector: 'span' })).toBeVisible();
  expect(screen.getByText('旧形式の取り込み記録あり・要照合')).toBeVisible();
  mockFetch.mockResolvedValue(response({ salons: [{ ...row, claimed_facility_id: id }], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: '一覧を再読み込み' }));
  expect(await screen.findByText('店舗作成済み（公開状態は別途確認）')).toBeVisible();
  view.unmount();
});
test('unmount aborts list request; deadline abort is surfaced, not left loading', async () => {
  jest.useFakeTimers();
  mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const view = render(<Page />);
  await act(async () => { jest.advanceTimersByTime(20000); });
  expect(screen.getByRole('alert')).toHaveTextContent('申込なしとは判定できません');
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  const signal = mockFetch.mock.calls[1][1].signal;
  await act(async () => { view.unmount(); });
  expect(signal.aborted).toBe(true);
});
