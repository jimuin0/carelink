import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type Notify = (event: AuthChangeEvent, session: Session | null) => void;
type RecoveryModule = typeof import('../password-recovery-session');

function load(): { mod: RecoveryModule; notify: Notify } {
  let notify!: Notify;
  let mod!: RecoveryModule;
  jest.isolateModules(() => {
    mod = require('../password-recovery-session');
  });
  mod.watchPasswordRecovery({ onAuthStateChange: (callback: Notify) => { notify = callback; } });
  return { mod, notify };
}

const session = (id: string, email?: string) => ({ user: { id, email } }) as unknown as Session;

test('nothing is recorded until the SDK reports PASSWORD_RECOVERY', () => {
  const { mod, notify } = load();
  notify('INITIAL_SESSION', session('existing-user', 'someone@example.invalid'));
  notify('SIGNED_IN', session('existing-user', 'someone@example.invalid'));
  expect(mod.getPasswordRecoveryUser()).toBeNull();
});

test('PASSWORD_RECOVERY records the account and notifies subscribers', () => {
  const { mod, notify } = load();
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  expect(mod.getPasswordRecoveryUser()).toEqual({ id: 'user-1', email: 'owner@example.invalid' });
  expect(listener).toHaveBeenCalledTimes(1);
});

test('an account without an email address is recorded with email null', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1'));
  expect(mod.getPasswordRecoveryUser()).toEqual({ id: 'user-1', email: null });
});

test('PASSWORD_RECOVERY without a session is ignored', () => {
  const { mod, notify } = load();
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  notify('PASSWORD_RECOVERY', null);
  expect(mod.getPasswordRecoveryUser()).toBeNull();
  expect(listener).not.toHaveBeenCalled();
});

test('token refresh and profile updates of the same account keep the record without notifying', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  notify('TOKEN_REFRESHED', session('user-1', 'owner@example.invalid'));
  notify('USER_UPDATED', session('user-1', 'owner@example.invalid'));
  expect(mod.getPasswordRecoveryUser()).toEqual({ id: 'user-1', email: 'owner@example.invalid' });
  expect(listener).not.toHaveBeenCalled();
});

test('signing out forgets the recovery session and notifies subscribers', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  notify('SIGNED_OUT', null);
  expect(mod.getPasswordRecoveryUser()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
});

test('switching to another account (e.g. from another tab) forgets the recovery session', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  notify('SIGNED_IN', session('user-2', 'other@example.invalid'));
  expect(mod.getPasswordRecoveryUser()).toBeNull();
});

test('unsubscribe stops notifications', () => {
  const { mod, notify } = load();
  const listener = jest.fn();
  const unsubscribe = mod.subscribePasswordRecovery(listener);
  unsubscribe();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  expect(listener).not.toHaveBeenCalled();
});

describe('recoveryUnavailableReason (why no recovery session was created)', () => {
  const page = 'https://carelink-jp.com/auth/reset-password';
  const reason = (href: string, initError: { code?: string } | null) =>
    load().mod.recoveryUnavailableReason(href, initError);

  test('an expired or already-used link (Supabase redirects with otp_expired) is reported as expired', () => {
    // 回帰: 以前はこの最も多い失敗でも「同じブラウザで開いてください」を主な原因として出していた
    expect(reason(
      `${page}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired`,
      { code: undefined },
    )).toBe('expired');
  });

  test('the error is also read from the fragment alone', () => {
    expect(reason(`${page}#error_code=otp_expired`, null)).toBe('expired');
    expect(reason(`${page}#error=access_denied`, null)).toBe('expired');
  });

  test.each([
    `${page}?error=server_error`,
    `${page}?error_code=unexpected_failure`,
    `${page}#error_description=Something+went+wrong`,
  ])('another error in the URL (%s) does not claim expiry', href => {
    expect(reason(href, null)).toBe('ended');
  });

  test('a code left in the URL that the SDK did not try to exchange means another browser', () => {
    // 申請したブラウザでないと PKCE の確認情報が無く、SDK はコードを交換せずエラーも返さない
    expect(reason(`${page}?code=abc`, null)).toBe('other-browser');
  });

  test.each(['flow_state_not_found', 'flow_state_expired', 'bad_code_verifier', 'otp_expired'])(
    'a code this browser failed to exchange (%s) is reported as expired',
    code => {
      expect(reason(`${page}?code=abc`, { code })).toBe('expired');
    },
  );

  test('a code exchange that failed for another reason (e.g. network) does not claim expiry', () => {
    expect(reason(`${page}?code=abc`, { code: 'unexpected_failure' })).toBe('ended');
    expect(reason(`${page}?code=abc`, {})).toBe('ended');
  });

  test('a page opened without any code or error (direct visit, reload after use) is reported as ended', () => {
    expect(reason(page, null)).toBe('ended');
    expect(reason(`${page}#code=abc`, null)).toBe('ended');
  });
});

test('clearPasswordRecovery forgets the record silently once the password has been changed', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  mod.clearPasswordRecovery();
  expect(mod.getPasswordRecoveryUser()).toBeNull();
  expect(listener).not.toHaveBeenCalled();
});
