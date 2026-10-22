/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import {
  SERVICE_WORKER_READY_TIMEOUT_MS, isPushSupported, subscribeThisDevice, unsubscribeThisDevice,
  urlBase64ToUint8Array, usePushSubscription,
} from '../usePushSubscription';

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
