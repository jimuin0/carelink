/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  useSearchParams: () => mockParams,
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockCreate() }));
jest.mock('@/lib/line-availability', () => ({ isLineLoginEnabled: () => false }));

beforeEach(() => {
  jest.resetAllMocks();
  mockParams = new URLSearchParams();
  mockCreate.mockImplementation(() => ({ auth: {
    getUser: mockGetUser, signInWithPassword: mockSignIn, signInWithOAuth: mockOAuth, resend: mockResend,
  } }));
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSignIn.mockResolvedValue({ error: null });
  mockResend.mockResolvedValue({ error: null });
});
afterEach(() => { jest.useRealTimers(); });

function submit(email = 'owner@example.com') {
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'ログイン', exact: true }));
}

async function unconfirmed() {
  mockSignIn.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
  render(<LoginPage />);
  submit();
  await screen.findByRole('button', { name: '確認メールを再送' });
}

test('正しい認証後は安全な店舗redirectへ遷移する', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin/onboarding?facility_name=test' });
  render(<LoginPage />);
  submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/onboarding?facility_name=test'));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('未確認メールはパスワード誤りとせず案内し、自動送信しない', async () => {
  await unconfirmed();
  expect(screen.getByText(/メールアドレスの確認が必要です/)).toBeVisible();
  expect(screen.queryByText('メールアドレスまたはパスワードが正しくありません')).not.toBeInTheDocument();
  expect(mockResend).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('不正資格情報では登録有無を明かさず再送導線を表示しない', async () => {
  mockSignIn.mockResolvedValue({ error: { code: 'invalid_credentials' } });
  render(<LoginPage />);
  submit();
  await screen.findByText('メールアドレスまたはパスワードが正しくありません');
  expect(screen.queryByRole('button', { name: '確認メールを再送' })).not.toBeInTheDocument();
});

test('再送は確認対象のメールと店舗遷移を保持し、連打を抑止する', async () => {
  mockParams = new URLSearchParams({ redirect: '/admin/onboarding?facility_name=test' });
  await unconfirmed();
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
  await unconfirmed();
  jest.useFakeTimers();
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
  await unconfirmed();
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
