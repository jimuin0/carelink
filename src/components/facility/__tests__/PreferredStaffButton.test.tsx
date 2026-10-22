/** @jest-environment jsdom */
/**
 * 指名スタッフの「指名登録」／「指名を解除」ボタン。
 * マイページの「指名スタッフ」が案内していた登録ボタンが実在し、押すと API を通して状態が変わることを、
 * 画面に出る結果（ボタンの名前・案内文・リンク先）で確かめる。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PreferredStaffButton, { PreferredStaffProvider } from '../PreferredStaffButton';

const mockGetUser = jest.fn();
const mockRead = jest.fn();
const mockIn = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => '/facility/synthetic/staff/hanako' }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, value: string) => ({
          in: (inCol: string, ids: string[]) => { mockIn(table, col, value, inCol, ids); return mockRead(); },
        }),
      }),
    }),
  }),
}));

const HANAKO = 'staff-hanako';
const TARO = 'staff-taro';

function renderDetail() {
  return render(
    <PreferredStaffProvider staffIds={[HANAKO]}>
      <PreferredStaffButton staffId={HANAKO} staffName="花子" />
    </PreferredStaffProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockRead.mockResolvedValue({ data: [], error: null });
  global.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});

test('未ログインなら、今のページへ戻るログイン導線を出す', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  renderDetail();
  const link = await screen.findByRole('link', { name: 'ログインして指名登録（花子さん）' });
  expect(link).toHaveAttribute('href', '/auth/login?redirect=%2Ffacility%2Fsynthetic%2Fstaff%2Fhanako');
  expect(link).toHaveTextContent('ログインして指名登録');
  expect(mockRead).not.toHaveBeenCalled();
});

test('施設ページのスタッフタブでは、ログイン後にそのタブへ戻れるよう #staff を付けて渡す', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  render(
    <PreferredStaffProvider staffIds={[HANAKO]} returnHash="#staff">
      <PreferredStaffButton staffId={HANAKO} staffName="花子" variant="card" />
    </PreferredStaffProvider>,
  );
  const link = await screen.findByRole('link', { name: 'ログインして指名登録（花子さん）' });
  expect(link).toHaveAttribute('href', '/auth/login?redirect=%2Ffacility%2Fsynthetic%2Fstaff%2Fhanako%23staff');
  // ログイン画面の safeRedirect は #hash を保ったまま同一オリジンのパスに戻す
  const { safeRedirect } = jest.requireActual('@/lib/safe-redirect') as typeof import('@/lib/safe-redirect');
  const redirect = new URL(link.getAttribute('href')!, 'https://example.invalid').searchParams.get('redirect');
  expect(safeRedirect(redirect, 'https://example.invalid')).toBe('/facility/synthetic/staff/hanako#staff');
});

test('未登録のスタッフを指名登録すると、解除ボタンとマイページへの案内に変わる', async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ nominated: true }) });
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: '指名登録（花子さん）' }));
  expect(await screen.findByRole('button', { name: '指名を解除（花子さん）' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith('/api/preferred-staff', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ staffId: HANAKO, nominated: true }),
  }));
  expect(screen.getByRole('status')).toHaveTextContent('指名スタッフに登録しました。');
  expect(screen.getByRole('link', { name: 'マイページで確認する' })).toHaveAttribute('href', '/mypage/staff');
  // 自分の行だけを、表示中のスタッフに絞って読んでいる
  expect(mockIn).toHaveBeenCalledWith('user_preferred_staff', 'user_id', 'synthetic-user', 'staff_id', [HANAKO]);
});

test('指名済みのスタッフは「指名を解除」から外せる', async () => {
  mockRead.mockResolvedValue({ data: [{ staff_id: HANAKO }], error: null });
  (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ nominated: false }) });
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: '指名を解除（花子さん）' }));
  expect(await screen.findByRole('button', { name: '指名登録（花子さん）' })).toBeEnabled();
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ staffId: HANAKO, nominated: false });
  expect(screen.getByRole('status')).toHaveTextContent('指名を解除しました。');
  expect(screen.queryByRole('link', { name: 'マイページで確認する' })).not.toBeInTheDocument();
});

test.each([
  ['ログイン状態を確認できない', () => mockGetUser.mockRejectedValue(new Error('network'))],
  ['指名状態を読めない', () => mockRead.mockResolvedValue({ data: null, error: { message: 'down' } })],
  ['指名状態の形が不正', () => mockRead.mockResolvedValue({ data: 'oops', error: null })],
])('%s時は「未登録」と決めつけず、押せない表示にする', async (_label, arrange) => {
  arrange();
  renderDetail();
  const button = await screen.findByRole('button', { name: '指名の状態を確認できません（花子さん）' });
  expect(button).toBeDisabled();
  expect(screen.queryByRole('button', { name: '指名登録（花子さん）' })).not.toBeInTheDocument();
});

test('確認中は押せず、画面の文字と読み上げ名が一致する（「指名登録」と見せない）', async () => {
  mockGetUser.mockReturnValue(new Promise(() => {}));
  renderDetail();
  const button = screen.getByRole('button', { name: '指名を確認中（花子さん）' });
  expect(button).toBeDisabled();
  // WCAG 2.5.3：見えている文字が読み上げ名に含まれる。指名済みの人に一瞬「指名登録」を見せない
  expect(button).toHaveTextContent('指名を確認中');
  expect(button).not.toHaveTextContent('指名登録');
});

test.each([
  ['API が理由を返した', { ok: false, status: 404, json: async () => ({ error: 'このスタッフは現在指名登録できません' }) }, 'このスタッフは現在指名登録できません'],
  ['API が理由を返さない', { ok: false, status: 500, json: async () => { throw new Error('not json'); } }, '指名を変更できませんでした。時間をおいて再度お試しください。'],
  ['成功応答の中身が合わない', { ok: true, status: 200, json: async () => ({}) }, '指名を変更できませんでした。時間をおいて再度お試しください。'],
  ['ログインが切れた', { ok: false, status: 401, json: async () => ({ error: '認証が必要です' }) }, 'ログインの有効期限が切れました。ページを再読み込みしてください。'],
])('%s場合は状態を変えずに理由を伝える', async (_label, response, text) => {
  (fetch as jest.Mock).mockResolvedValue(response);
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: '指名登録（花子さん）' }));
  expect(await screen.findByText(text)).toBeVisible();
  expect(screen.getByRole('button', { name: '指名登録（花子さん）' })).toBeEnabled();
});

test('通信に失敗した場合も状態を変えずに伝える', async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: '指名登録（花子さん）' }));
  expect(await screen.findByText('指名を変更できませんでした。通信状況を確認して再度お試しください。')).toBeVisible();
  expect(screen.getByRole('button', { name: '指名登録（花子さん）' })).toBeEnabled();
});

test('送信中の二度押しは 1 回しか送らない', async () => {
  let resolve!: (value: unknown) => void;
  (fetch as jest.Mock).mockReturnValue(new Promise((r) => { resolve = r; }));
  renderDetail();
  const button = await screen.findByRole('button', { name: '指名登録（花子さん）' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => { resolve({ ok: true, status: 200, json: async () => ({ nominated: true }) }); });
  expect(screen.getByRole('button', { name: '指名を解除（花子さん）' })).toBeEnabled();
});

test('一覧ではログイン確認と指名状態の読み取りを 1 回にまとめ、カードごとに状態を出し分ける', async () => {
  mockRead.mockResolvedValue({ data: [{ staff_id: TARO }], error: null });
  render(
    <PreferredStaffProvider staffIds={[HANAKO, TARO]}>
      <PreferredStaffButton staffId={HANAKO} staffName="花子" variant="card" />
      <PreferredStaffButton staffId={TARO} staffName="太郎" variant="card" />
    </PreferredStaffProvider>,
  );
  expect(await screen.findByRole('button', { name: '指名登録（花子さん）' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '指名を解除（太郎さん）' })).toBeEnabled();
  expect(mockGetUser).toHaveBeenCalledTimes(1);
  expect(mockIn).toHaveBeenCalledTimes(1);
  expect(mockIn).toHaveBeenCalledWith('user_preferred_staff', 'user_id', 'synthetic-user', 'staff_id', [HANAKO, TARO]);

  (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ nominated: true }) });
  fireEvent.click(screen.getByRole('button', { name: '指名登録（花子さん）' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '指名を解除（花子さん）' })).toBeEnabled());
  // カードではマイページへのリンクまでは出さない（狭い枠に詰め込まない）
  expect(screen.queryByRole('link', { name: 'マイページで確認する' })).not.toBeInTheDocument();
});

test('Provider の外では何も描かない', () => {
  const { container } = render(<PreferredStaffButton staffId={HANAKO} staffName="花子" />);
  expect(container).toBeEmptyDOMElement();
});

test('ページを離れた後に届いた読み取り結果は反映しない', async () => {
  let resolve!: (value: unknown) => void;
  mockRead.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = renderDetail();
  await waitFor(() => expect(mockRead).toHaveBeenCalled());
  view.unmount();
  await act(async () => { resolve({ data: [{ staff_id: HANAKO }], error: null }); });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
