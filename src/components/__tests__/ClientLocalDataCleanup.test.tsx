import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import ClientLocalDataCleanup from '../ClientLocalDataCleanup';
import { completeClientCleanupMarker, hasClientCleanupNeeded, markClientCleanupNeeded } from '@/lib/client-cleanup-marker';
import { clearAccountLocalData, LOCAL_DATA_CLEAR_FAILED } from '@/lib/client-storage';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/client-storage', () => ({ clearAccountLocalData: jest.fn(), LOCAL_DATA_CLEAR_FAILED: '端末の下書き削除を確認できませんでした。' }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));
const wipe = clearAccountLocalData as jest.Mock;
let authEvent: (event: AuthChangeEvent, session: null) => void;
const unsubscribe = jest.fn();
beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks(); completeClientCleanupMarker(); wipe.mockResolvedValue(undefined);
  (createBrowserSupabaseClient as jest.Mock).mockImplementation(() => ({ auth: {
    onAuthStateChange: (listener: typeof authEvent) => { authEvent = listener; listener('INITIAL_SESSION', null); return { data: { subscription: { unsubscribe } } }; },
  } }));
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); completeClientCleanupMarker(); });

test('normal guests and null initial sessions retain their deliberately saved input', async () => {
  render(<ClientLocalDataCleanup />);
  await act(async () => { authEvent('INITIAL_SESSION', null); authEvent('TOKEN_REFRESHED', null); authEvent('SIGNED_IN', null); });
  expect(wipe).not.toHaveBeenCalled(); expect(hasClientCleanupNeeded()).toBe(false); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('an old retirement-tab marker stays fenced until verified boot cleanup succeeds', async () => {
  let done!: () => void; wipe.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
  document.cookie = 'carelink_client_cleanup=1; Path=/'; render(<ClientLocalDataCleanup />);
  await screen.findByRole('alert'); await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1));
  expect(hasClientCleanupNeeded()).toBe(true); expect(screen.getByRole('button', { name: '端末の下書き削除を再試行' })).toBeDisabled();
  await act(async () => { done(); });
  expect(hasClientCleanupNeeded()).toBe(false); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('failed wipe retains the cookie and a visible manual retry; successful retry clears both', async () => {
  markClientCleanupNeeded(); wipe.mockRejectedValueOnce(new Error('private details')); render(<ClientLocalDataCleanup />);
  await screen.findByText(LOCAL_DATA_CLEAR_FAILED); expect(hasClientCleanupNeeded()).toBe(true);
  expect(screen.queryByText('private details')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '端末の下書き削除を再試行' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument()); expect(hasClientCleanupNeeded()).toBe(false);
  expect(wipe).toHaveBeenCalledTimes(2);
});
test('explicit SIGNED_OUT marks before wiping; unrelated auth notifications never substitute for logout', async () => {
  let done!: () => void; wipe.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; })); render(<ClientLocalDataCleanup />);
  await act(async () => { authEvent('SIGNED_OUT', null); });
  expect(hasClientCleanupNeeded()).toBe(true); expect(document.cookie).toContain('carelink_client_cleanup=1');
  await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1)); await act(async () => { done(); });
  expect(hasClientCleanupNeeded()).toBe(false);
});
test('focus/pageshow signals share an in-progress wipe, while later old-tab cookies are rechecked', async () => {
  let done!: () => void; markClientCleanupNeeded(); wipe.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
  render(<ClientLocalDataCleanup />); await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
  expect(wipe).toHaveBeenCalledTimes(1); await act(async () => { done(); });
  document.cookie = 'carelink_client_cleanup=1; Path=/'; await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(wipe).toHaveBeenCalledTimes(2); expect(hasClientCleanupNeeded()).toBe(false);
});
test('boot marker cleanup still runs if the auth subscription cannot be created', async () => {
  markClientCleanupNeeded(); (createBrowserSupabaseClient as jest.Mock).mockImplementationOnce(() => { throw new Error('private init detail'); });
  render(<ClientLocalDataCleanup />); await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1));
  expect(hasClientCleanupNeeded()).toBe(false);
});
test('a dropped marker write stays fenced in memory and the explicit retry can recover', async () => {
  wipe.mockRejectedValueOnce(new Error('synthetic unverified wipe'));
  render(<ClientLocalDataCleanup />); const dropped = jest.spyOn(document, 'cookie', 'set').mockImplementation(() => {});
  await act(async () => { authEvent('SIGNED_OUT', null); }); await screen.findByText(LOCAL_DATA_CLEAR_FAILED);
  expect(hasClientCleanupNeeded()).toBe(true); expect(wipe).toHaveBeenCalledTimes(1); dropped.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '端末の下書き削除を再試行' }));
  await waitFor(() => expect(hasClientCleanupNeeded()).toBe(false)); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('unmount unsubscribes; an already-started privacy wipe completes without setting detached UI state', async () => {
  let done!: () => void; markClientCleanupNeeded(); wipe.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
  const view = render(<ClientLocalDataCleanup />); await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1)); view.unmount(); expect(unsubscribe).toHaveBeenCalled();
  await act(async () => { done(); }); expect(hasClientCleanupNeeded()).toBe(false);
});
