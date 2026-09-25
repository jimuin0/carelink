/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from '@/app/auth/login/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

const searchParams = new URLSearchParams();
const getUser = jest.fn();
const signInWithOAuth = jest.fn();
const signInWithPassword = jest.fn();
const resend = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => searchParams,
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));
jest.mock('@/lib/line-availability', () => ({ isLineLoginEnabled: () => false }));

beforeEach(() => {
  searchParams.forEach((_, key) => searchParams.delete(key));
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.test' }, error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser, signInWithOAuth, signInWithPassword, resend },
  });
});

function fillLoginForm() {
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
}

test('callback_failedを再ログイン可能な利用者向け文言で表示する', async () => {
  searchParams.set('error', 'callback_failed');
  searchParams.set('redirect', '/admin/onboarding');
  render(<LoginPage />);

  expect(await screen.findByText('ログインの確認を完了できませんでした。もう一度ログインをお試しください。')).toBeInTheDocument();
  expect(screen.getByText(/ログイン後、施設情報の登録を続けます。/)).toBeInTheDocument();
});

test('Googleログイン開始の連打は1回に抑止し、返却errorを画面上に表示する', async () => {
  let resolveOAuth: ((value: unknown) => void) | undefined;
  signInWithOAuth.mockImplementation(() => new Promise((resolve) => { resolveOAuth = resolve; }));
  render(<LoginPage />);
  const button = screen.getByRole('button', { name: 'Googleでログイン' });

  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(signInWithOAuth).toHaveBeenCalledTimes(1);

  await act(async () => resolveOAuth?.({ data: { url: null }, error: { message: 'provider unavailable' } }));
  expect(await screen.findByText('Googleでのログインを開始できませんでした。時間をおいてもう一度お試しください。')).toBeInTheDocument();
});

test('未確認メールのログイン失敗には確認メールの再送導線を出す', async () => {
  jest.useFakeTimers();
  signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
  render(<LoginPage />);
  fillLoginForm();
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

  expect(await screen.findByText('メールの確認が完了していません。確認メールを再送できます。')).toBeInTheDocument();
  const resendButton = screen.getByRole('button', { name: '確認メールの再送は1分後にできます' });
  expect(resendButton).toBeDisabled();
  fireEvent.click(resendButton);
  expect(resend).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(60_000));
  fireEvent.click(screen.getByRole('button', { name: '確認メールを再送する' }));
  await screen.findByText(/確認が必要なアカウントにはメールが届きます/);
  expect(resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'test@example.com' }));
  jest.useRealTimers();
});

test('パスワードログインの応答待ち中はGoogleログインを開始できない', async () => {
  let resolvePassword: ((value: unknown) => void) | undefined;
  signInWithPassword.mockImplementation(() => new Promise((resolve) => { resolvePassword = resolve; }));
  render(<LoginPage />);
  fillLoginForm();
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

  const googleButton = screen.getByRole('button', { name: 'Googleでログイン' });
  expect(googleButton).toBeDisabled();
  fireEvent.click(googleButton);
  expect(signInWithOAuth).not.toHaveBeenCalled();

  await act(async () => resolvePassword?.({ error: null }));
});

test.each([
  [{ code: 'unexpected_failure', message: 'unexpected' }],
  [{ code: 'unknown', message: 'Failed to fetch' }],
])('一時的なAuth障害はパスワード誤りと断定しない', async (error) => {
  signInWithPassword.mockResolvedValue({ error });
  render(<LoginPage />);
  fillLoginForm();
  fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

  expect(await screen.findByText('ログイン処理の結果を確認できませんでした。接続を確認してもう一度お試しください。')).toBeInTheDocument();
});

test('Google障害からbfcache復帰したら認証操作を再開できる', async () => {
  signInWithOAuth.mockImplementation(() => new Promise(() => {}));
  render(<LoginPage />);
  const button = screen.getByRole('button', { name: 'Googleでログイン' });
  fireEvent.click(button);
  expect(button).toBeDisabled();

  const pageShow = new Event('pageshow');
  Object.defineProperty(pageShow, 'persisted', { value: true });
  act(() => window.dispatchEvent(pageShow));

  expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled();
});
