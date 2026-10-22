/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  AuthApiError,
  AuthImplicitGrantRedirectError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';
import ResetPasswordPage from '../page';
import {
  clearPasswordRecovery,
  getPasswordRecoveryUser,
  watchPasswordRecovery,
} from '@/lib/password-recovery-session';
import { PASSWORD_TOO_LONG_MESSAGE, RECOVERY_LINK_EXPIRED_MESSAGE } from '@/lib/password-reset';

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

// 案内文。主な原因は太字の 1 文目に出る。
const SAME_BROWSER = '再設定を申請したのと同じブラウザでリンクを開いてください。';
const IN_APP_BROWSER =
  'メールアプリ内のブラウザで開いている場合は、メニューの「ブラウザで開く」を選ぶか、このページのアドレスをコピーして、再設定を申請したブラウザで開いてください。';
const LINK_EXPIRED = 'このリンクは有効期限が切れているか、すでに使用されています。';
const COULD_NOT_RESET = 'パスワードを再設定できませんでした。';

/** ページを開いたときの URL（メールのリンクから戻ってきた形）を再現する。 */
function openedAt(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

beforeEach(() => {
  jest.resetAllMocks();
  openedAt('/auth/reset-password');
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
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(COULD_NOT_RESET);
    expect(notice).toHaveTextContent('再設定のリンクは一度しか使えず、有効期限もあります。お手数ですが、もう一度申請してください。');
    expect(notice).toHaveTextContent('新しいリンクは、申請したのと同じブラウザで開いてください。');
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
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a recovery already completed before the page mounted (header created the client first) is not missed', async () => {
    notifyAuth('PASSWORD_RECOVERY', recoverySession());
    render(<ResetPasswordPage />);
    expect(await screen.findByTestId('recovery-email')).toHaveTextContent('owner@example.invalid');
  });

  test('a PASSWORD_RECOVERY arriving after the guidance was shown upgrades to the form', async () => {
    render(<ResetPasswordPage />);
    await screen.findByText(COULD_NOT_RESET);
    act(() => { notifyAuth('PASSWORD_RECOVERY', recoverySession()); });
    expect(await screen.findByLabelText('新しいパスワード')).toBeInTheDocument();
  });

  test('signing out in another tab takes the form away and moves focus to the explanation', async () => {
    recoveryLinkOpened();
    render(<ResetPasswordPage />);
    (await screen.findByLabelText('新しいパスワード')).focus();
    act(() => { notifyAuth('SIGNED_OUT', null); });
    const headline = await screen.findByText(COULD_NOT_RESET);
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
    expect(headline).toHaveFocus();
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
    expect(await screen.findByText(COULD_NOT_RESET)).toBeInTheDocument();
  });

  test('if the stored session switched to another account before submit, that account is not changed', async () => {
    recoveryLinkOpened();
    mockGetSession.mockResolvedValue({ data: { session: recoverySession('someone-else', 'other@example.invalid') }, error: null });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    const headline = await screen.findByText(COULD_NOT_RESET);
    // 押したボタンごとフォームが消えるので、フォーカスは案内へ移す
    expect(headline).toHaveFocus();
    expect(screen.getByRole('alert')).toContainElement(headline);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(getPasswordRecoveryUser()).toBeNull();
  });

  test('if the stored session is gone before submit, nothing is sent and a new link is offered', async () => {
    recoveryLinkOpened();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(RECOVERY_LINK_EXPIRED_MESSAGE);
    const requestAgain = screen.getByRole('link', { name: '再設定をもう一度申請する' });
    expect(requestAgain).toHaveAttribute('href', '/auth/forgot-password');
    expect(requestAgain).toHaveFocus();
    // 同じセッションでは何度送っても通らないので、入力も止める
    expect(screen.getByLabelText('新しいパスワード')).toBeDisabled();
    expect(screen.getByLabelText('パスワード（確認）')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'パスワードを更新' })).toBeDisabled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(getPasswordRecoveryUser()).toBeNull();
  });

  test('a temporary failure to read the session keeps the recovery so the user can retry (regression)', async () => {
    // 旧実装: getSession の error を見ず、通信の一時失敗を「アカウントが切り替わった」と扱って
    // 回復用の記録を消していた。リンクは使用済みなので、やり直す手段が無くなっていた。
    recoveryLinkOpened();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    render(<ResetPasswordPage />);
    await fillAndSubmit('new-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードを更新できませんでした。時間をおいてもう一度お試しください。');
    expect(screen.queryByText(COULD_NOT_RESET)).not.toBeInTheDocument();
    expect(getPasswordRecoveryUser()).toEqual({ id: 'owner-id', email: 'owner@example.invalid' });
    expect(screen.getByRole('button', { name: 'パスワードを更新' })).toBeEnabled();
    expect(mockUpdateUser).not.toHaveBeenCalled();

    // 通信が戻れば、そのまま同じフォームで更新できる
    mockGetSession.mockResolvedValue({ data: { session: recoverySession() }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを更新' }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'new-password-1' }));
  });

  test('unmounting stops following later auth events', async () => {
    const { unmount } = render(<ResetPasswordPage />);
    await screen.findByText(COULD_NOT_RESET);
    unmount();
    expect(() => notifyAuth('PASSWORD_RECOVERY', recoverySession())).not.toThrow();
  });
});

describe('why the form is not available (regression: every failure used to blame the browser)', () => {
  test('an expired or already-used link says so instead of blaming the browser', async () => {
    // Supabase は使用済み・期限切れのリンクを /verify で拒否し、この形で戻してくる
    openedAt('/auth/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    mockInitialize.mockResolvedValue({
      error: new AuthImplicitGrantRedirectError('Email link is invalid or has expired', { error: 'access_denied', code: 'otp_expired' }),
    });
    render(<ResetPasswordPage />);
    const notice = await screen.findByRole('alert');
    expect(screen.getByText(LINK_EXPIRED)).toHaveClass('font-bold');
    expect(notice).toHaveTextContent('お手数ですが、もう一度再設定を申請してください。');
    expect(notice).not.toHaveTextContent(SAME_BROWSER);
    expect(screen.getByRole('link', { name: '再設定をもう一度申請する' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
  });

  test('a code this browser could not exchange because it was already used is reported as expired', async () => {
    openedAt('/auth/reset-password?code=used-code');
    mockInitialize.mockResolvedValue({ error: new AuthApiError('invalid flow state, no valid flow state found', 404, 'flow_state_not_found') });
    render(<ResetPasswordPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(LINK_EXPIRED);
  });

  test('a code left unexchanged (opened in another browser) explains how to move it to the right browser', async () => {
    // 申請したブラウザでないと SDK はコードを交換せず、URL にコードが残る。
    // そのアドレスを申請したブラウザで開けば、まだ再設定できる。
    openedAt('/auth/reset-password?code=unexchanged-code');
    render(<ResetPasswordPage />);
    const notice = await screen.findByRole('alert');
    expect(screen.getByText(SAME_BROWSER)).toHaveClass('font-bold');
    expect(notice).toHaveTextContent(IN_APP_BROWSER);
    expect(notice).toHaveTextContent('このページのアドレスは時間がたつと使えなくなります。その場合は、もう一度申請してください。');
    expect(notice).not.toHaveTextContent(LINK_EXPIRED);
    expect(screen.getByRole('link', { name: '再設定をもう一度申請する' })).toHaveAttribute('href', '/auth/forgot-password');
  });

  test('the in-app browser advice is not shown when the link simply expired', async () => {
    openedAt('/auth/reset-password#error=access_denied&error_code=otp_expired');
    render(<ResetPasswordPage />);
    await screen.findByText(LINK_EXPIRED);
    expect(screen.queryByText(IN_APP_BROWSER)).not.toBeInTheDocument();
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
    const field = await screen.findByLabelText('新しいパスワード');
    expect(field).toHaveAccessibleDescription('8文字以上、半角72文字以内（全角文字は1文字を3文字分として数えます）');
    expect(field).toHaveAttribute('placeholder', '8文字以上');
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

  test('other weak passwords explain the rules production actually enforces', async () => {
    const alert = await failWith(new AuthWeakPasswordError('weak', 422, ['length']));
    expect(alert).toHaveTextContent('このパスワードは安全性の条件を満たしていません。8文字以上で入力してください。');
    expect(alert).not.toHaveTextContent('大文字');
  });

  test('the same password as before asks for a different one', async () => {
    const alert = await failWith(new AuthApiError('same', 422, 'same_password'));
    expect(alert).toHaveTextContent('以前と異なるパスワードを入力してください。');
  });

  test('a missing session keeps the expired-link message and links to a new request', async () => {
    const alert = await failWith(new AuthSessionMissingError());
    expect(alert).toHaveTextContent('リンクの有効期限が切れている可能性があります。');
    expect(screen.getByRole('link', { name: '再設定をもう一度申請する' })).toHaveAttribute('href', '/auth/forgot-password');
    expect(screen.getByRole('button', { name: 'パスワードを更新' })).toBeDisabled();
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
