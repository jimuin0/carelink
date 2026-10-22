/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthApiError, AuthSessionMissingError, AuthWeakPasswordError } from '@supabase/supabase-js';
import ResetPasswordPage from '../page';
import {
  clearPasswordRecovery,
  getPasswordRecoveryUser,
  watchPasswordRecovery,
} from '@/lib/password-recovery-session';
import { PASSWORD_TOO_LONG_MESSAGE } from '@/lib/password-reset';

const mockPush = jest.fn();
const mockCreate = jest.fn();
const mockInitialize = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockCreate() }));

// 本物の台帳（password-recovery-session）を使い、SDK の認証イベントだけを差し替える。
let notifyAuth: (event: AuthChangeEvent, session: Session | null) => void;
const recoverySession = (id = 'owner-id', email = 'owner@example.invalid') =>
  ({ user: { id, email } }) as unknown as Session;

beforeEach(() => {
  jest.resetAllMocks();
  clearPasswordRecovery();
  watchPasswordRecovery({ onAuthStateChange: callback => { notifyAuth = callback; } });
  mockCreate.mockImplementation(() => ({
    auth: { initialize: mockInitialize, getSession: mockGetSession, updateUser: mockUpdateUser },
  }));
  mockInitialize.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({ data: { session: recoverySession() }, error: null });
  mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
});
afterEach(() => { jest.useRealTimers(); });

/** SDK が URL の認証コードを交換し、初期化の後に PASSWORD_RECOVERY を通知する流れを再現する。 */
function recoveryLinkOpened(session = recoverySession()) {
  mockInitialize.mockImplementation(async () => {
    setTimeout(() => notifyAuth('PASSWORD_RECOVERY', session), 0);
    return { error: null };
  });
}

async function fillAndSubmit(password: string, confirm = password) {
  fireEvent.change(await screen.findByLabelText('新しいパスワード'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('パスワード（確認）'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新' }));
}

describe('which session the form is allowed to change', () => {
  test('a session that already existed in the browser never gets a password form (regression)', async () => {
    // 旧実装: ログイン中の別アカウントのセッションに対して、そのまま updateUser を呼べた
    mockGetSession.mockResolvedValue({ data: { session: recoverySession('someone-else') }, error: null });
    render(<ResetPasswordPage />);
    expect(screen.getByRole('status')).toHaveTextContent('リンクを確認しています');
    expect(await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。')).toBeInTheDocument();
    expect(screen.getByText('パスワードを再設定できませんでした。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '再設定をもう一度申請する' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'パスワードを更新' })).not.toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('a recovery link opened on this page load shows the form with the account email', async () => {
    recoveryLinkOpened();
    render(<ResetPasswordPage />);
    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument();
    expect(screen.getByText('パスワードを変更するアカウント')).toBeInTheDocument();
    expect(screen.getByTestId('recovery-email')).toHaveTextContent('owner@example.invalid');
    expect(screen.queryByText('再設定を申請したのと同じブラウザでリンクを開いてください。')).not.toBeInTheDocument();
  });

  test('a recovery already completed before the page mounted (header created the client first) is not missed', async () => {
    notifyAuth('PASSWORD_RECOVERY', recoverySession());
    render(<ResetPasswordPage />);
    expect(await screen.findByTestId('recovery-email')).toHaveTextContent('owner@example.invalid');
  });

  test('a PASSWORD_RECOVERY arriving after the guidance was shown upgrades to the form', async () => {
    render(<ResetPasswordPage />);
    await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。');
    act(() => { notifyAuth('PASSWORD_RECOVERY', recoverySession()); });
    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument();
  });

  test('signing out in another tab takes the form away', async () => {
    recoveryLinkOpened();
    render(<ResetPasswordPage />);
    await screen.findByLabelText('新しいパスワード');
    act(() => { notifyAuth('SIGNED_OUT', null); });
    expect(await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。')).toBeInTheDocument();
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
  });

  test('an account without an email still gets the form, without an empty account box', async () => {
    recoveryLinkOpened({ user: { id: 'owner-id' } } as unknown as Session);
    render(<ResetPasswordPage />);
    await screen.findByLabelText('新しいパスワード');
    expect(screen.queryByText('パスワードを変更するアカウント')).not.toBeInTheDocument();
  });

  test('a client that cannot be created falls back to the guidance instead of crashing', async () => {
    mockCreate.mockImplementation(() => { throw new Error('missing env'); });
    render(<ResetPasswordPage />);
    expect(await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。')).toBeInTheDocument();
  });

  test('if the stored session switched to another account before submit, that account is not changed', async () => {
    recoveryLinkOpened();
    mockGetSession.mockResolvedValue({ data: { session: recoverySession('someone-else', 'other@example.invalid') }, error: null });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    expect(await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。')).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(getPasswordRecoveryUser()).toBeNull();
  });

  test('if the stored session is gone before submit, nothing is sent', async () => {
    recoveryLinkOpened();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('unmounting stops following later auth events', async () => {
    const { unmount } = render(<ResetPasswordPage />);
    await screen.findByText('再設定を申請したのと同じブラウザでリンクを開いてください。');
    unmount();
    expect(() => notifyAuth('PASSWORD_RECOVERY', recoverySession())).not.toThrow();
  });
});

describe('client-side checks', () => {
  test('a password over 72 bytes is stopped before it reaches the server', async () => {
    recoveryLinkOpened();
    render(<ResetPasswordPage />);
    await fillAndSubmit('あ'.repeat(25));
    expect(await screen.findByText(PASSWORD_TOO_LONG_MESSAGE)).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('the length rule is announced next to the field', async () => {
    recoveryLinkOpened();
    render(<ResetPasswordPage />);
    expect(await screen.findByLabelText('新しいパスワード')).toHaveAccessibleDescription(
      '8文字以上、半角72文字以内（全角文字は1文字を3文字分として数えます）',
    );
  });
});

describe('what an update failure says (regression: every error used to say "link expired")', () => {
  async function failWith(error: unknown) {
    recoveryLinkOpened();
    mockUpdateUser.mockResolvedValue({ data: { user: null }, error });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    return screen.findByRole('alert');
  }

  test('a leaked password asks for another password', async () => {
    const alert = await failWith(new AuthWeakPasswordError('weak', 422, ['pwned']));
    expect(alert).toHaveTextContent('このパスワードは過去に流出したものとして使用できません。別のパスワードを入力してください。');
    expect(alert).not.toHaveTextContent('有効期限');
    expect(screen.queryByRole('link', { name: '再設定をもう一度申請する' })).not.toBeInTheDocument();
    // フォームはそのまま使える
    expect(screen.getByRole('button', { name: 'パスワードを更新' })).toBeEnabled();
  });

  test('other weak passwords explain the rules', async () => {
    const alert = await failWith(new AuthWeakPasswordError('weak', 422, ['characters']));
    expect(alert).toHaveTextContent('英字の大文字・小文字・数字・記号を組み合わせてください。');
  });

  test('the same password as before asks for a different one', async () => {
    const alert = await failWith(new AuthApiError('same', 422, 'same_password'));
    expect(alert).toHaveTextContent('以前と異なるパスワードを入力してください。');
  });

  test('a missing session keeps the expired-link message and links to a new request', async () => {
    const alert = await failWith(new AuthSessionMissingError());
    expect(alert).toHaveTextContent('リンクの有効期限が切れている可能性があります。');
    expect(screen.getByRole('link', { name: '再設定をもう一度申請する' })).toHaveAttribute('href', '/auth/forgot-password');
  });

  test('anything else shows a neutral retry message', async () => {
    const alert = await failWith(new AuthApiError('boom', 500, 'unexpected_failure'));
    expect(alert).toHaveTextContent('パスワードを更新できませんでした。時間をおいてもう一度お試しください。');
    expect(alert).not.toHaveTextContent('有効期限');
  });

  test('a thrown error is shown as the neutral retry message', async () => {
    recoveryLinkOpened();
    mockGetSession.mockRejectedValue(new Error('lock timeout'));
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードを更新できませんでした。時間をおいてもう一度お試しください。');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('a retry after a failure clears the previous message', async () => {
    expect(await failWith(new AuthApiError('same', 422, 'same_password'))).toHaveTextContent('以前と異なるパスワードを入力してください。');
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新' }));
    await waitFor(() => expect(screen.queryByText('以前と異なるパスワードを入力してください。')).not.toBeInTheDocument());
  });
});

test('a successful update changes only the recovered account, then goes to login', async () => {
  recoveryLinkOpened();
  render(<ResetPasswordPage />);
  await screen.findByLabelText('新しいパスワード');
  jest.useFakeTimers();
  await fillAndSubmit('new-password-1');
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
  expect(screen.getByText('パスワードを更新しました。ログインページに移動します。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'パスワードを更新' })).toBeDisabled();
  // 同じリンクで作られた記録は二度使わない
  expect(getPasswordRecoveryUser()).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(mockPush).toHaveBeenCalledWith('/auth/login');
});
