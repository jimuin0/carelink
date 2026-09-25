/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupPage from '@/app/auth/signup/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

const searchParams = new URLSearchParams();
const replace = jest.fn();
const refresh = jest.fn();
const getUser = jest.fn();
const signUp = jest.fn();
const resend = jest.fn();
const signInWithOAuth = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => searchParams,
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));
jest.mock('@/lib/line-availability', () => ({ isLineLoginEnabled: () => false }));

function fillSignupForm() {
  fireEvent.change(screen.getByLabelText(/^お名前/), { target: { value: '山田太郎' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '090-1234-5678' } });
  fireEvent.change(screen.getByLabelText(/^都道府県/), { target: { value: '東京都' } });
  fireEvent.change(document.getElementById('signup-password')!, { target: { value: 'password' } });
  fireEvent.change(screen.getByLabelText(/^パスワード（確認）/), { target: { value: 'password' } });
}

beforeEach(() => {
  searchParams.forEach((_, key) => searchParams.delete(key));
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
  signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: null }, error: null });
  resend.mockResolvedValue({ error: null });
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.test' }, error: null });
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser, signUp, resend, signInWithOAuth },
  });
});

test('確認待ちでは送達を断定せず、直後の再送を止める', async () => {
  render(<SignupPage />);
  fillSignupForm();
  fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

  expect(await screen.findByText('登録を受け付けました。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '確認メールの再送は1分後にできます' })).toBeDisabled();
  expect(screen.getByText(/メール確認が必要な場合は/)).toBeInTheDocument();
});

test('sessionが返る環境は確認待ちを表示せず安全な戻り先へ遷移する', async () => {
  searchParams.set('redirect', '/admin/onboarding');
  signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: { access_token: 'not-rendered' } }, error: null });
  render(<SignupPage />);
  fillSignupForm();
  fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/onboarding'));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('店舗ログイン経由の新規登録は店舗向けの登録文脈を表示する', async () => {
  searchParams.set('redirect', '/admin');
  render(<SignupPage />);

  expect(await screen.findByText(/施設オーナーさま向けのアカウント作成です/)).toBeInTheDocument();
  expect(screen.getByText(/登録後、管理画面へ移動します/)).toBeInTheDocument();
  expect(screen.getByText('1〜50文字で入力してください。姓と名の間のスペースはあってもなくても構いません。')).toBeInTheDocument();
  expect(screen.getByText('8〜128文字で入力してください。英字・数字・記号を組み合わせる必要はありません。')).toBeInTheDocument();
  expect(document.getElementById('signup-name')).toHaveAttribute('required');
  expect(document.getElementById('signup-password')).toHaveAttribute('required');
});

test('通信失敗を一般的な登録失敗へ潰さず、結果不明として案内する', async () => {
  signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'unexpected_failure', message: 'Failed to fetch' } });
  render(<SignupPage />);
  fillSignupForm();
  fireEvent.click(screen.getByRole('button', { name: '新規登録' }));

  expect(await screen.findByText('登録処理の結果を確認できませんでした。受信メールをご確認のうえ、時間をおいてもう一度お試しください。')).toBeInTheDocument();
});

test('Google障害からbfcache復帰したら認証操作を再開できる', async () => {
  signInWithOAuth.mockImplementation(() => new Promise(() => {}));
  render(<SignupPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Googleで登録' }));
  expect(screen.getByRole('button', { name: 'Googleに移動しています...' })).toBeDisabled();

  const pageShow = new Event('pageshow');
  Object.defineProperty(pageShow, 'persisted', { value: true });
  act(() => window.dispatchEvent(pageShow));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Googleで登録' })).toBeEnabled());
});
