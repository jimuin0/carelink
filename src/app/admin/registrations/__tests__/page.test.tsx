/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../page';
const id = '74000000-0000-4000-8000-000000000001';
const time = '2026-09-26T12:30:40.123456+00:00';
const row = { id, name: '合成施設', email: 'synthetic@example.invalid', phone: null, source: 'register' as 'register' | 'recruit' | null,
  status: 'pending', created_at: time, claimed_at: null, claimed_facility_id: null, review_revision: 0, classification: null, classification_revision: 0, hidden: false, approval_notice: 'none' as 'none' | 'queued' | 'sent' | 'uncertain' | 'failed' };
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
  // 承認だけでは公開されないこと・承認でメールが送られること・公開までの流れを運営に明示する（2026-11-03 実際に誤解が起きた）。
  expect(screen.getByRole('heading', { name: '掲載までの流れ' })).toBeVisible();
  expect(screen.getAllByText(/承認だけでは公開されません/)[0]).toBeVisible();
  expect(screen.getByText(/内容を確認し、問題なければ「承認」してください。申込者へ続きの手順のメールが送られます/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('検索項目'), { target: { value: 'email' } });
  fireEvent.change(screen.getByLabelText('検索値'), { target: { value: ' Synthetic.Name+tag@GoogleMail.com ' } });
  fireEvent.change(screen.getByLabelText('審査状態'), { target: { value: 'approved' } });
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  const [url, options] = mockFetch.mock.calls[1];
  expect(url).toBe('/api/admin/registrations');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ field: 'email', query: 'Synthetic.Name+tag@GoogleMail.com', status: 'approved', cursor: null, visibility: 'visible' });
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
  expect(screen.getByRole('dialog')).toHaveTextContent('この申込からは店舗を作れなくなります。申込者への通知は送られません。');
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockFetch.mock.calls.some(([, options]) => options.method === 'PATCH')).toBe(false);
});
test('mutation serializes clicks and search, checks business success then reloads', async () => {
  const patch = deferred();
  mockFetch.mockResolvedValueOnce(response()).mockReturnValueOnce(patch.promise).mockResolvedValue(response({ salons: [{ ...row, status: 'approved' }], nextCursor: null }));
  render(<Page />); await screen.findByText('合成施設');
  // 承認は申込者へメールを送るので、押す前に宛先と内容を確認させる。確認前は何も送らない。
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  expect(screen.getByRole('dialog')).toHaveTextContent('申込者（synthetic@example.invalid）へ、店舗の作成と書類提出の手順を案内するメールが送られます');
  expect(screen.getByRole('dialog')).toHaveTextContent('承認だけでは公開されません');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '承認する' }));
  expect(screen.getByRole('button', { name: '承認', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: '検索する' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '一覧を再読み込み' })).toBeDisabled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  await act(async () => { patch.resolve(response({ success: true })); });
  expect(await screen.findByText('承認済', { selector: 'span' })).toBeVisible();
  expect(screen.getByText('合成施設を承認しました。申込者へ続きの手順のメールを送ります（15分以内）。送信できたら Slack に通知します')).toBeVisible();
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
  fireEvent.click(screen.getByRole('button', { name: '承認する' }));
  expect(await screen.findByText(/結果を確認できませんでした/)).toBeVisible();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/合成施設を承認しました/)).not.toBeInTheDocument();
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
  expect(await screen.findByText('受付 日時未設定')).toBeVisible();
  expect(screen.getByText('状態未設定', { selector: 'span' })).toBeVisible();
  expect(screen.getByText('旧形式の取り込み記録あり・要照合')).toBeVisible();
  mockFetch.mockResolvedValue(response({ salons: [{ ...row, claimed_facility_id: id }], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: '一覧を再読み込み' }));
  expect(await screen.findByText('店舗作成済み（公開状態は書類確認の欄で確認）')).toBeVisible();
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

test('unconfirmed registrations can be classified only with a confirmed update and reload', async () => {
  render(<Page />); await screen.findByText('合成施設');
  expect(screen.getByRole('combobox', { name: '合成施設の申込の種類' })).toHaveValue('unknown');
  expect(screen.getByText(/見分け用のメモです。公開・通知には影響しません/)).toBeVisible();
  mockFetch.mockResolvedValueOnce(response({ success: true, classification: 'test', revision: 1 }));
  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, classification: 'test', classification_revision: 1 }], nextCursor: null }));
  fireEvent.change(screen.getByRole('combobox', { name: '合成施設の申込の種類' }), { target: { value: 'test' } });
  expect(await screen.findByText('テスト・検証用', { selector: 'span' })).toBeVisible();
  expect(screen.getByText('テスト・検証用として記録しました')).toBeVisible();
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ classification: 'test', expected_revision: 0 });
});
test('unknown classification update blocks changes until successful reload', async () => {
  render(<Page />); await screen.findByText('合成施設');
  mockFetch.mockResolvedValueOnce(response({}, false));
  fireEvent.change(screen.getByRole('combobox', { name: '合成施設の申込の種類' }), { target: { value: 'test' } });
  expect(await screen.findByText('区分の更新結果を確認できません。一覧を再読み込みしてください。')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '合成施設の申込の種類' })).toBeDisabled();
});

test.each([['real', '本物の申込として記録しました'], ['unknown', '未確認として記録しました']] as const)('confirmed %s classification is reported and reloaded', async (value, message) => {
  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, classification: 'test', classification_revision: 1 }], nextCursor: null }));
  render(<Page />); await screen.findByText('テスト・検証用', { selector: 'span' });
  mockFetch.mockResolvedValueOnce(response({ success: true, classification: value, revision: 2 }));
  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, classification: value, classification_revision: 2 }], nextCursor: null }));
  fireEvent.change(screen.getByRole('combobox', { name: '合成施設の申込の種類' }), { target: { value } });
  expect(await screen.findByText(message)).toBeVisible();
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ classification: value, expected_revision: 1 });
});
test.each(['success', 'failure'])('superseded classification %s cannot update an unmounted screen', async mode => {
  const { unmount } = render(<Page />); await screen.findByText('合成施設');
  const pending = deferred(); mockFetch.mockReturnValueOnce(pending.promise);
  const select = screen.getByRole('combobox', { name: '合成施設の申込の種類' });
  act(() => { fireEvent.change(select, { target: { value: 'test' } }); fireEvent.change(select, { target: { value: 'test' } }); });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  // Abort and generation change are observed even if an underlying fetch settles late.
  const mounted = screen.getByText('合成施設');
  expect(mounted).toBeVisible();
  unmount();
  await act(async () => { if (mode === 'success') pending.resolve(response({ success: true, classification: 'test', revision: 1 })); else pending.reject(new Error('offline')); });
});

test('hiding is display-only, confirmed by the server, and reversible from the hidden view', async () => {
  render(<Page />); await screen.findByText('合成施設');
  expect(screen.getByText(/申込・店舗・公開状態・通知は変わらず、データも削除しません/)).toBeVisible();
  mockFetch.mockResolvedValueOnce(response({ success: true, hidden: true }));
  mockFetch.mockResolvedValueOnce(response({ salons: [], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: '一覧から隠す' }));
  expect(await screen.findByText('合成施設を一覧から隠しました。「一覧から隠した申込」から戻せます')).toBeVisible();
  expect(mockFetch.mock.calls[1][0]).toBe(`/api/admin/registrations/${id}/visibility`);
  expect(mockFetch.mock.calls[1][1].method).toBe('PATCH');
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ hidden: true });
  expect(await screen.findByText('この条件・ページに該当する登録申請はありません')).toBeVisible();

  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, hidden: true }], nextCursor: null }));
  fireEvent.change(screen.getByLabelText('表示する申込'), { target: { value: 'hidden' } });
  fireEvent.click(screen.getByRole('button', { name: '検索する' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toMatchObject({ visibility: 'hidden', cursor: null });
  mockFetch.mockResolvedValueOnce(response({ success: true, hidden: false }));
  mockFetch.mockResolvedValueOnce(response({ salons: [], nextCursor: null }));
  fireEvent.click(await screen.findByRole('button', { name: '一覧に戻す' }));
  expect(await screen.findByText('合成施設を一覧に戻しました')).toBeVisible();
  expect(JSON.parse(mockFetch.mock.calls[4][1].body)).toEqual({ hidden: false });
  expect(await screen.findByText('一覧から隠した申込はありません')).toBeVisible();
});
test.each([
  ['business failure', () => Promise.resolve(response({ success: false }, false))],
  ['wrong acknowledgement', () => Promise.resolve(response({ success: true, hidden: false }))],
  ['network failure', () => Promise.reject(new Error('offline'))],
])('unconfirmed hide (%s) blocks further changes until reload', async (_label, result) => {
  render(<Page />); await screen.findByText('合成施設');
  mockFetch.mockImplementationOnce(result);
  fireEvent.click(screen.getByRole('button', { name: '一覧から隠す' }));
  expect(await screen.findByText('表示の更新結果を確認できません。一覧を再読み込みしてください。')).toBeVisible();
  expect(screen.getByRole('button', { name: '一覧から隠す' })).toBeDisabled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
test.each(['success', 'failure'])('superseded hide %s cannot update an unmounted screen', async mode => {
  const { unmount } = render(<Page />); await screen.findByText('合成施設');
  const pending = deferred(); mockFetch.mockReturnValueOnce(pending.promise);
  const button = screen.getByRole('button', { name: '一覧から隠す' });
  act(() => { button.click(); button.click(); });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => {
    if (mode === 'success') pending.resolve(response({ success: true, hidden: true }));
    else pending.reject(new Error('late'));
  });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('approval of a non-form registration says no email is sent', async () => {
  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, source: 'recruit' }], nextCursor: null }));
  render(<Page />); await screen.findByText('合成施設');
  expect(screen.getByText(/承認してもメールは送られません/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '承認', exact: true }));
  expect(screen.getByRole('dialog')).toHaveTextContent('掲載申込フォーム以外からのため、メールは送られません');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
test.each([
  [{ status: 'approved', source: 'register', approval_notice: 'sent' }, '申込者へ続きの手順のメールを送信しました。申込者が同じメールアドレスでログインして店舗を作成するのを待っています'],
  [{ status: 'approved', source: 'register', approval_notice: 'queued' }, '申込者へのメールは送信待ちです（15分以内）'],
  [{ status: 'approved', source: 'register', approval_notice: 'uncertain' }, '送信を始めましたが届いたか確認できていません。送信記録を確かめるまで、個別の案内や再送はしないでください'],
  [{ status: 'approved', source: 'register', approval_notice: 'failed' }, '申込者へのメールを送れませんでした。お問い合わせの返信などで、個別に続きの手順を案内してください'],
  [{ status: 'approved', source: 'register', approval_notice: 'none' }, '申込者へのメールは送っていません（メールの仕組みができる前の承認）'],
  [{ status: 'approved', source: 'recruit' }, '承認のメールは送られていません'],
  [{ status: 'rejected' }, '却下済みです。この申込からは店舗を作れません。'],
] as const)('next step explains what happens now %#', async (patch, text) => {
  mockFetch.mockResolvedValueOnce(response({ salons: [{ ...row, ...patch }], nextCursor: null }));
  render(<Page />); await screen.findByText('合成施設');
  expect(screen.getByText(new RegExp(text))).toBeVisible();
});
