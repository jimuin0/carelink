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

test('clearPasswordRecovery forgets the record silently once the password has been changed', () => {
  const { mod, notify } = load();
  notify('PASSWORD_RECOVERY', session('user-1', 'owner@example.invalid'));
  const listener = jest.fn();
  mod.subscribePasswordRecovery(listener);
  mod.clearPasswordRecovery();
  expect(mod.getPasswordRecoveryUser()).toBeNull();
  expect(listener).not.toHaveBeenCalled();
});
