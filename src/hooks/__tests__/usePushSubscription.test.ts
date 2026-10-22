/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import {
  SERVICE_WORKER_READY_TIMEOUT_MS, SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS, isPushSupported, readThisDevicePushStatus,
  releaseThisDevicePush, subscribeThisDevice, unsubscribeThisDevice, urlBase64ToUint8Array, usePushSubscription,
} from '../usePushSubscription';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';
const requestPermission = jest.fn();
const fetchMock = jest.fn();

function browser(registration: unknown) {
  (global as unknown as { Notification: unknown }).Notification = { permission: 'default', requestPermission };
  (global as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: () => Promise.resolve(registration) },
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
});
afterAll(() => { delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; });

test('base64url の VAPID 公開鍵をバイト列に戻す', () => {
  expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
});

test('VAPID 公開鍵が無ければ対応外として扱い、登録も失敗にする（通知を送れないのに登録させない）', async () => {
  browser(undefined);
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  expect(isPushSupported()).toBe(false);
  await expect(subscribeThisDevice()).resolves.toBe('failed');
  expect(requestPermission).not.toHaveBeenCalled();
});

test('通知を許可されなければ購読もサーバー保存もしない', async () => {
  const subscribe = jest.fn();
  browser({ pushManager: { subscribe } });
  requestPermission.mockResolvedValue('denied');
  await expect(subscribeThisDevice()).resolves.toBe('denied');
  expect(subscribe).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

// Service Worker が登録されないと navigator.serviceWorker.ready は永久に解決しない。
// 以前はそれを待ち続け、管理画面のボタンが「登録中...」のまま押せなくなっていた（回帰防止）。
test('Service Worker が準備できないまま上限を過ぎたら、購読もサーバー保存もせず失敗にする', async () => {
  jest.useFakeTimers();
  try {
    const subscribe = jest.fn();
    browser({ pushManager: { subscribe } });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: new Promise(() => {}), getRegistration: () => Promise.resolve(undefined) },
    });
    requestPermission.mockResolvedValue('granted');
    const outcome = subscribeThisDevice();
    await jest.advanceTimersByTimeAsync(SERVICE_WORKER_READY_TIMEOUT_MS);
    await expect(outcome).resolves.toBe('failed');
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('Service Worker が準備できれば購読してサーバーへ保存する', async () => {
  const subscribe = jest.fn().mockResolvedValue({
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }),
  });
  browser({ pushManager: { subscribe } });
  requestPermission.mockResolvedValue('granted');
  fetchMock.mockResolvedValue({ ok: true });
  await expect(subscribeThisDevice()).resolves.toBe('subscribed');
  expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' }));
});

test('この端末に購読が無ければ、解除はサーバーへ何も送らずに完了する', async () => {
  browser({ pushManager: { getSubscription: () => Promise.resolve(null) } });
  await expect(unsubscribeThisDevice()).resolves.toBe('unsubscribed');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('サーバーの行を消せた後はブラウザ側の購読解除に失敗しても解除済みとする', async () => {
  const unsubscribe = jest.fn().mockRejectedValue(new Error('synthetic'));
  browser({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://fcm.googleapis.com/x', unsubscribe }) } });
  fetchMock.mockResolvedValue({ ok: true });
  await expect(unsubscribeThisDevice()).resolves.toBe('unsubscribed');
  expect(unsubscribe).toHaveBeenCalled();
});

test('フックは登録・解除の例外を失敗として表示用の状態に残し、呼び出し元へは投げない', async () => {
  browser({ pushManager: { getSubscription: () => Promise.reject(new Error('synthetic')) } });
  requestPermission.mockRejectedValue(new Error('synthetic'));
  const { result } = renderHook(() => usePushSubscription());

  let outcome: string | undefined;
  await act(async () => { outcome = await result.current.subscribe(); });
  expect(outcome).toBe('failed');
  expect(result.current.error).toBe('subscribe');
  expect(result.current.busy).toBe(false);

  await act(async () => { outcome = await result.current.unsubscribe(); });
  expect(outcome).toBe('failed');
  expect(result.current.error).toBe('unsubscribe');
});

// E21: ログインが切れていた（401）のは時間をおいても直らない。失敗とは分けて返し、案内を変えられるようにする。
test('サーバーがログインを確認できない（401）ときは signed_out を返し、フックも別の状態にする', async () => {
  const subscribe = jest.fn().mockResolvedValue({
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }),
  });
  browser({ pushManager: { subscribe } });
  requestPermission.mockResolvedValue('granted');
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await expect(subscribeThisDevice()).resolves.toBe('signed_out');
  const { result } = renderHook(() => usePushSubscription());
  await act(async () => { await result.current.subscribe(); });
  expect(result.current.error).toBe('signed_out');
});

describe('この端末の登録状況（E21：ブラウザの許可だけで判定しない）', () => {
  const HERE = 'https://fcm.googleapis.com/fcm/send/here';
  function signedIn(user: { id: string } | null, server: { endpoint: string } | null, error: unknown = null) {
    (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: server, error }) }) }) }),
    });
  }
  function device(permission: NotificationPermission, local: string | null) {
    browser({ pushManager: { getSubscription: () => Promise.resolve(local ? { endpoint: local } : null) } });
    (global as unknown as { Notification: { permission: string } }).Notification.permission = permission;
  }

  test('VAPID 未設定は unsupported、ブロック済みは blocked（どちらもサーバーを見ない）', async () => {
    device('denied', null);
    signedIn({ id: 'u' }, null);
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'blocked' });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'unsupported' });
  });

  test('ログインしていなければ signed_out（保存できないので登録させない）', async () => {
    device('default', null);
    signedIn(null, null);
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'signed_out' });
  });

  test('許可済み・この端末の endpoint とサーバーの行が一致 → registered', async () => {
    device('granted', HERE);
    signedIn({ id: 'u' }, { endpoint: HERE });
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'registered' });
  });

  test('許可済みでもサーバーの行が消えていれば unregistered（以前はここで二度と案内されなかった）', async () => {
    device('granted', HERE);
    signedIn({ id: 'u' }, null);
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'unregistered', otherDevice: false });
  });

  test('サーバーの行が別の端末なら unregistered（otherDevice）', async () => {
    device('granted', HERE);
    signedIn({ id: 'u' }, { endpoint: 'https://fcm.googleapis.com/fcm/send/other' });
    await expect(readThisDevicePushStatus()).resolves.toEqual({ state: 'unregistered', otherDevice: true });
  });

  test('サーバーの行を読めなければ例外（未登録と取り違えない）', async () => {
    device('default', null);
    signedIn({ id: 'u' }, null, { code: '522' });
    await expect(readThisDevicePushStatus()).rejects.toEqual({ code: '522' });
  });
});

describe('ログアウト・退会時の端末の通知の後始末（E20）', () => {
  const EP = 'https://fcm.googleapis.com/fcm/send/shared-pc';
  function withSubscription(unsubscribe = jest.fn().mockResolvedValue(true)) {
    browser({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: EP, unsubscribe }) } });
    return unsubscribe;
  }

  test('ログアウト：サーバーの行（この端末の endpoint）を消してから、ブラウザの購読も外す', async () => {
    const unsubscribe = withSubscription();
    fetchMock.mockResolvedValue({ ok: true });
    await releaseThisDevicePush({ serverRow: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ endpoint: EP }) }));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0]);
  });

  test('サーバー側の削除に失敗しても、ブラウザの購読は必ず外す（endpoint が失効し、次の送信で行も掃除される）', async () => {
    const unsubscribe = withSubscription();
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(releaseThisDevicePush({ serverRow: true })).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('退会後：サーバーの行はアカウント削除で消えているので送らず、ブラウザの購読だけ外す', async () => {
    const unsubscribe = withSubscription();
    await releaseThisDevicePush({ serverRow: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('購読が無い・Service Worker が無い・ブラウザの解除が失敗しても、例外を出さずに終わる', async () => {
    browser({ pushManager: { getSubscription: () => Promise.resolve(null) } });
    await releaseThisDevicePush({ serverRow: true });
    expect(fetchMock).not.toHaveBeenCalled();
    browser(undefined);
    await expect(releaseThisDevicePush({ serverRow: true })).resolves.toBeUndefined();
    withSubscription(jest.fn().mockRejectedValue(new Error('synthetic')));
    fetchMock.mockResolvedValue({ ok: true });
    await expect(releaseThisDevicePush({ serverRow: true })).resolves.toBeUndefined();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: () => Promise.reject(new Error('synthetic')) } });
    await expect(releaseThisDevicePush({ serverRow: true })).resolves.toBeUndefined();
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    await expect(releaseThisDevicePush({ serverRow: true })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('後始末が終わらなくても上限を過ぎたら待たずに戻る（ログアウトを止めない）', async () => {
    jest.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: () => new Promise(() => {}) } });
      let done = false;
      const pending = releaseThisDevicePush({ serverRow: true }).then(() => { done = true; });
      await jest.advanceTimersByTimeAsync(SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
