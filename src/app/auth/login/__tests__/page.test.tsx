/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server.node';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import LoginPage from '../page';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
let mockParams = new URLSearchParams();
const mockCreate = jest.fn();
const mockGetUser = jest.fn();
const mockSignIn = jest.fn();
const mockOAuth = jest.fn();
const mockResend = jest.fn();
const mockSignOut = jest.fn();
const mockClearData = jest.fn();
const mockMarkCleanup = jest.fn();
const mockCompleteCleanup = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  useSearchParams: () => mockParams,
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockCreate() }));
jest.mock('@/lib/line-availability', () => ({ isLineLoginEnabled: () => false }));
jest.mock('@/lib/client-storage', () => ({ clearAccountLocalData: () => mockClearData(), LOCAL_DATA_CLEAR_FAILED: '端末の下書き削除を確認できませんでした。' }));
jest.mock('@/lib/client-cleanup-marker', () => ({ markClientCleanupNeeded: () => mockMarkCleanup(), completeClientCleanupMarker: () => mockCompleteCleanup() }));

beforeEach(() => {
  jest.resetAllMocks();
  mockParams = new URLSearchParams();
  mockCreate.mockImplementation(() => ({ auth: {
    getUser: mockGetUser, signInWithPassword: mockSignIn, signInWithOAuth: mockOAuth, resend: mockResend, signOut: mockSignOut,
  } }));
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSignIn.mockResolvedValue({ error: null });
  mockResend.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockClearData.mockResolvedValue(undefined);
});
afterEach(() => { jest.useRealTimers(); });

async function signedInStoreLogin(error?: string) {
  mockParams = new URLSearchParams({ redirect: '/admin/bookings?date=2026-10-13', ...(error ? { error } : {}) });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'customer', email: 'customer@example.invalid' } } });
  render(<LoginPage />);
  await screen.findByRole('button', { name: '別のアカウントでログイン' });
}

test('signed-in store login offers choices without silently routing to admin/mypage or logging out', async () => {
  await signedInStoreLogin();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'このアカウントで管理画面を開く' })).toHaveAttribute('href', '/admin/bookings?date=2026-10-13');
  expect(screen.getByRole('link', { name: '新しくお店を登録する' })).toHaveAttribute('href', '/admin/onboarding');
});

test('permission denial explains missing store access and keeps account switching available', async () => {
  await signedInStoreLogin('store_access_required');
  expect(screen.getByRole('alert')).toHaveTextContent('このアカウントでは、お店を管理できません');
  expect(screen.queryByRole('link', { name: 'このアカウントで管理画面を開く' })).not.toBeInTheDocument();
  expect(screen.getByText('登録したお店・写真・予約はそのままです。')).toBeInTheDocument();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('switch logs out only this session and waits for privacy cleanup before showing credentials', async () => {
  await signedInStoreLogin();
  let finish!: () => void;
  mockClearData.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログイン' }));
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  expect(mockSignOut).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  await screen.findByLabelText('パスワード');
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockClearData).toHaveBeenCalledTimes(2);
  expect(mockCompleteCleanup).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
});

// E20: 共用端末でアカウントを切り替えても、前のアカウント宛ての Push がこの端末に届き続けないようにする。
test('switching account releases this device push subscription before the previous session is signed out', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/shared';
  const unsubscribe = jest.fn().mockResolvedValue(true);
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  const originalFetch = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({ endpoint, unsubscribe }) } }),
  } });
  try {
    await signedInStoreLogin();
    fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログイン' }));
    await screen.findByLabelText('パスワード');
    expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ endpoint }) }));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(mockSignOut.mock.invocationCallOrder[0]);
  } finally {
    global.fetch = originalFetch;
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  }
});

test('pre-logout privacy cleanup failure blocks logout and new credentials', async () => {
  await signedInStoreLogin();
  mockClearData.mockRejectedValueOnce(new Error('storage unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログイン' }));
  await screen.findByRole('alert');
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  expect(mockCompleteCleanup).not.toHaveBeenCalled();
});

test('logout provider error never claims that account switching completed', async () => {
  await signedInStoreLogin();
  mockSignOut.mockResolvedValueOnce({ error: { message: 'unavailable' } });
  fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログイン' }));
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('post-logout cleanup failure retries cleanup without another logout or exposing login controls', async () => {
  await signedInStoreLogin();
  mockClearData.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログイン' }));
  await screen.findByRole('button', { name: '端末の下書き削除を再試行' });
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '端末の下書き削除を再試行' }));
  await screen.findByLabelText('パスワード');
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockCompleteCleanup).toHaveBeenCalledTimes(1);
});

test('store credentials remain absent while identity is pending, including before hydration', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin' });
  let finish!: (value: unknown) => void;
  mockGetUser.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const html = renderToString(<LoginPage />);
  expect(html).not.toContain('id="login-password"');
  render(<LoginPage />);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Googleでログイン' })).not.toBeInTheDocument();
  await act(async () => { finish({ data: { user: { id: 'customer' } }, error: null }); });
  await screen.findByRole('button', { name: '別のアカウントでログイン' });
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockClearData).not.toHaveBeenCalled();
});

test('unknown store identity keeps credentials locked and can retry to a confirmed absent session', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin' });
  mockGetUser.mockRejectedValueOnce(new Error('network unavailable'));
  render(<LoginPage />);
  await screen.findByRole('button', { name: 'ログイン状態を再確認' });
  expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ログイン状態を再確認' }));
  await screen.findByLabelText('パスワード');
  expect(mockGetUser).toHaveBeenCalledTimes(2);
  expect(mockSignOut).not.toHaveBeenCalled();
});

test('normal consumer login still automatically continues a verified session', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'customer' } } });
  render(<LoginPage />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/mypage'));
});

test('store Google login requests explicit account selection', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin' });
  mockOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/example' }, error: null });
  render(<LoginPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Googleでログイン' }));
  await waitFor(() => expect(mockOAuth).toHaveBeenCalledWith(expect.objectContaining({
    options: expect.objectContaining({ queryParams: { prompt: 'select_account' } }),
  })));
});

function submit(email = 'owner@example.com') {
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'ログイン', exact: true }));
}
test('SSR keeps login controls and Google disabled until client handlers are installed', () => {
  const document = window.document.createElement('div');
  document.innerHTML = renderToString(<LoginPage />);
  expect(document.querySelector('#login-email')).toBeDisabled();
  expect(document.querySelector('#login-password')).toBeDisabled();
  expect(Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Googleでログイン')).toBeDisabled();
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(mockSignIn).not.toHaveBeenCalled();
});
test('unsettled initial verification keeps the form/input and does not navigate for a late user',async()=>{
 jest.useFakeTimers();let finish!: (value:unknown)=>void;
 mockGetUser.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<LoginPage />);
 expect(screen.getByLabelText('メールアドレス')).toBeEnabled();
 expect(screen.getByRole('button',{name:'Googleでログイン'})).toBeEnabled();
 fireEvent.change(screen.getByLabelText('メールアドレス'),{target:{value:'retained@example.invalid'}});
 await act(async()=>{await jest.advanceTimersByTimeAsync(5000);});
 await act(async()=>{finish({data:{user:{id:'late'}}});await Promise.resolve();});
 expect(mockReplace).not.toHaveBeenCalled();expect(screen.getByLabelText('メールアドレス')).toHaveValue('retained@example.invalid');
 expect(screen.getByRole('button',{name:'ログイン',exact:true})).toBeEnabled();
});

async function unconfirmed() {
  jest.useFakeTimers();
  mockSignIn.mockResolvedValue({ error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed') });
  render(<LoginPage />);
  await act(async () => { submit(); });
  expect(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' })).toBeDisabled();
}

async function readyForResend() {
  await unconfirmed();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(screen.getByRole('button', { name: '確認メールを再送' })).toBeEnabled();
}

test('正しい認証後は安全な店舗redirectへ遷移する', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin/onboarding?facility_name=test' });
  render(<LoginPage />);
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/onboarding?facility_name=test'));
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('未確認メールはパスワード誤りとせず案内し、自動送信しない', async () => {
  await unconfirmed();
  expect(screen.getByText(/メールアドレスの確認が必要です/)).toBeVisible();
  expect(screen.queryByText('メールアドレスまたはパスワードが正しくありません')).not.toBeInTheDocument();
  expect(mockResend).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('signupからログインへ移っても初回未確認SDK応答から60秒間は再送を開始できない', async () => {
  await unconfirmed();
  fireEvent.click(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' }));
  expect(mockResend).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(59_999); });
  expect(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' }));
  expect(mockResend).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });
  fireEvent.click(screen.getByRole('button', { name: '確認メールを再送' }));
  await act(async () => {});
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockResend).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' })).toBeDisabled();
});

test('不正資格情報では登録有無を明かさず再送導線を表示しない', async () => {
  mockSignIn.mockResolvedValue({ error: { code: 'invalid_credentials' } });
  render(<LoginPage />);
  submit();
  await screen.findByText('メールアドレスまたはパスワードが正しくありません');
  expect(screen.queryByRole('button', { name: '確認メールを再送' })).not.toBeInTheDocument();
});

test.each([
  new AuthRetryableFetchError('private gateway detail', 522),
  new AuthRetryableFetchError('private network detail', 0),
  new AuthApiError('private upstream detail', 500, 'unexpected_failure'),
  new AuthApiError('private unknown detail', 400, 'unknown_server_code'),
])('SDKが返す通信・不明エラー（%s）は資格情報誤りにせず、入力保持で再試行できる', async error => {
  mockSignIn.mockResolvedValueOnce({ error });
  render(<LoginPage />); submit('retry@example.invalid');
  await screen.findByText('ログイン認証に接続できませんでした。時間をおいてもう一度お試しください。');
  expect(screen.queryByText('メールアドレスまたはパスワードが正しくありません')).not.toBeInTheDocument();
  expect(screen.queryByText(/private .* detail/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('メールアドレス')).toHaveValue('retry@example.invalid');
  expect(screen.getByLabelText('パスワード')).toHaveValue('password123');
  expect(mockPush).not.toHaveBeenCalled(); expect(mockResend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'ログイン', exact: true }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
  expect(mockSignIn).toHaveBeenLastCalledWith({ email: 'retry@example.invalid', password: 'password123' });
});

test.each([
  new AuthApiError('private throttle detail', 429, 'unknown_server_code'),
  new AuthApiError('private throttle detail', 400, 'over_request_rate_limit'),
  new AuthApiError('private throttle detail', 400, 'over_email_send_rate_limit'),
])('返却rate-limit（%s）は待機案内を表示し、送信や画面遷移を始めない', async error => {
  mockSignIn.mockResolvedValueOnce({ error });
  render(<LoginPage />); submit();
  await screen.findByText('ログインの試行回数が上限に達しました。時間をおいてもう一度お試しください。');
  expect(screen.queryByText(/private throttle detail/)).not.toBeInTheDocument();
  expect(screen.queryByText('メールアドレスまたはパスワードが正しくありません')).not.toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled(); expect(mockResend).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'ログイン', exact: true })).toBeEnabled();
});

test('再送は確認対象のメールと店舗遷移を保持し、連打を抑止する', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin/onboarding?facility_name=test' });
  await readyForResend();
  // 入力欄を変えても別アドレスへ誤送信しない。
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'other@example.com' } });
  const button = screen.getByRole('button', { name: '確認メールを再送' });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText('再送を受け付けました。確認が必要なアカウントにはメールが届きます。');
  expect(mockResend).toHaveBeenCalledTimes(1);
  expect(mockResend).toHaveBeenCalledWith({
    type: 'signup', email: 'owner@example.com',
    options: { emailRedirectTo: 'http://localhost/auth/callback?redirect=%2Fadmin%2Fonboarding%3Ffacility_name%3Dtest' },
  });
  expect(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' })).toBeDisabled();
});

test.each(['returned', 'thrown'])('再送失敗（%s）は中立案内と60秒制限の後に再試行可能', async (failure) => {
  await readyForResend();
  if (failure === 'returned') mockResend.mockResolvedValueOnce({ error: { message: 'private detail' } });
  else mockResend.mockRejectedValueOnce(new Error('private detail'));
  fireEvent.click(screen.getByRole('button', { name: '確認メールを再送' }));
  await act(async () => {});
  expect(screen.getByText('再送を完了できませんでした。時間をおいてもう一度お試しください。')).toBeVisible();
  expect(screen.queryByText('private detail')).not.toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(59_999); });
  expect(screen.getByRole('button', { name: '再送は60秒ほどお待ちください' })).toBeDisabled();
  await act(async () => { jest.advanceTimersByTime(1); });
  fireEvent.click(screen.getByRole('button', { name: '確認メールを再送' }));
  await act(async () => {});
  expect(mockResend).toHaveBeenCalledTimes(2);
});

test('悪意あるredirectを再送のcallbackへ渡さない', async () => {
  mockParams = new URLSearchParams({ redirect: '/\\evil.example' });
  await readyForResend();
  fireEvent.click(screen.getByRole('button', { name: '確認メールを再送' }));
  await waitFor(() => expect(mockResend).toHaveBeenCalledWith(expect.objectContaining({
    options: { emailRedirectTo: 'http://localhost/auth/callback?redirect=%2Fmypage' },
  })));
});

test.each(['client', 'request'])('ログイン例外（%s）後はロックを解除して再試行可能', async (failure) => {
  render(<LoginPage />);
  if (failure === 'client') mockCreate.mockImplementationOnce(() => { throw new Error('init'); });
  else mockSignIn.mockRejectedValueOnce(new Error('network'));
  submit();
  await screen.findByText('ログイン認証に接続できませんでした。時間をおいてもう一度お試しください。');
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
});

test.each(['client', 'request'])('初期セッション確認の例外（%s）後もログイン可能', async (failure) => {
  if (failure === 'client') mockCreate.mockImplementationOnce(() => { throw new Error('init'); });
  else mockGetUser.mockRejectedValueOnce(new Error('network'));
  render(<LoginPage />);
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
});

test('マウント後に確認できた既存セッションを安全な遷移先へ送る', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'fixture' } } });
  render(<LoginPage />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/mypage'));
});

test.each(['returned', 'thrown', 'empty'])('Google開始失敗（%s）で説明し、パスワードログインへ復帰可能', async (failure) => {
  if (failure === 'returned') mockOAuth.mockResolvedValue({ error: { message: 'failed' }, data: { url: null } });
  else if (failure === 'thrown') mockOAuth.mockRejectedValue(new Error('network'));
  else mockOAuth.mockResolvedValue({ error: null, data: { url: null } });
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }));
  await screen.findByText('Googleでのログインを開始できませんでした。時間をおいてもう一度お試しください。');
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
});

test('Google遷移中は認証競合を防ぎ、戻る操作でフォームを復帰する', async () => {
  mockOAuth.mockResolvedValue({ error: null, data: { url: 'https://accounts.google.com/' } });
  render(<LoginPage />);
  const button = screen.getByRole('button', { name: 'Googleでログイン' });
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => {});
  expect(mockOAuth).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'ログイン', exact: true })).toBeDisabled();
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
  expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled();
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
});

test('callback失敗はログイン画面で説明する', () => {
  mockParams = new URLSearchParams({ error: 'callback_failed' });
  render(<LoginPage />);
  expect(screen.getByText('ログイン認証を完了できませんでした。時間をおいてもう一度お試しください。')).toBeVisible();
});

test('password login grants one navigation and does not refresh the outgoing document', async () => {
  render(<LoginPage />);
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
  submit();
  await act(async () => {});
  expect(mockSignIn).toHaveBeenCalledTimes(1);
});

test('late initial identity observation cannot replace a successful password navigation', async () => {
  let release!: (value: unknown) => void;
  mockGetUser.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  render(<LoginPage />);
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mypage'));
  await act(async () => { release({ data: { user: { id: 'synthetic-late-identity' } }, error: null }); });
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

test('a failed navigation releases its latch so the user can explicitly retry', async () => {
  mockPush.mockImplementationOnce(() => { throw new Error('synthetic navigation failure'); });
  render(<LoginPage />);
  submit();
  await screen.findByText('ログイン認証に接続できませんでした。時間をおいてもう一度お試しください。');
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
});
