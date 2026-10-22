'use client';

import { useState } from 'react';

/**
 * この端末（ブラウザ）の Web Push 購読の登録・解除（2026年10月22日 共通化）。
 *
 * 予約者向けの PushPermissionBanner と、店舗オーナー向けの管理画面（通知設定）の両方が使う。
 * 以前は登録処理が PushPermissionBanner の中にだけあり、管理画面には「Push通知」の
 * ON/OFF トグルがあるのに、オーナーが端末を登録する手段が 1 つも無かった
 * （トグルを ON にしても通知の届け先が存在しない）。
 *
 * push_subscriptions は UNIQUE(user_id)＝1 人 1 端末。別の端末で登録すると前の端末は置き換わる。
 */

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** この端末・この環境でプッシュ通知を使えるか（VAPID 公開鍵の設定とブラウザの対応の両方が要る）。 */
export function isPushSupported(): boolean {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false;
  if (typeof window === 'undefined') return false;
  return 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window;
}

/** この端末の購読の endpoint（未登録・Service Worker 未登録なら null）。 */
export async function readThisDeviceEndpoint(): Promise<string | null> {
  // ready は Service Worker が登録されるまで解決しないため、状態の確認には使わない。
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

export type SubscribeOutcome = 'subscribed' | 'denied' | 'failed';
export type UnsubscribeOutcome = 'unsubscribed' | 'failed';

/** 通知を許可してもらい、この端末を購読してサーバーへ保存する。保存に失敗したら 'failed'（成功に見せない）。 */
export async function subscribeThisDevice(): Promise<SubscribeOutcome> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return 'failed';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
  });

  const subJson = subscription.toJSON();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
  });
  // res.ok を見ないと、サーバー保存に失敗しても登録済みに見えてしまう。
  return res.ok ? 'subscribed' : 'failed';
}

/**
 * この端末の通知を解除する。先にサーバーの行（本人かつこの端末の endpoint のものだけ）を消し、
 * 成功してからブラウザ側の購読を外す。サーバー側が失敗したらブラウザ側は残し 'failed'
 * （「解除した」と表示したのに通知が届き続ける状態を作らない）。
 */
export async function unsubscribeThisDevice(): Promise<UnsubscribeOutcome> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return 'unsubscribed';
  const res = await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!res.ok) return 'failed';
  // サーバーの行は消えたので、ここで失敗しても通知は届かない（後片付けだけ）。
  await subscription.unsubscribe().catch(() => false);
  return 'unsubscribed';
}

/** 登録・解除の実行状態（処理中・失敗）を持つフック。結果そのものは呼び出し側が受け取って扱う。 */
export function usePushSubscription() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'subscribe' | 'unsubscribe' | null>(null);

  const subscribe = async (): Promise<SubscribeOutcome> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await subscribeThisDevice();
      if (outcome === 'failed') setError('subscribe');
      return outcome;
    } catch {
      setError('subscribe');
      return 'failed';
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async (): Promise<UnsubscribeOutcome> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await unsubscribeThisDevice();
      if (outcome === 'failed') setError('unsubscribe');
      return outcome;
    } catch {
      setError('unsubscribe');
      return 'failed';
    } finally {
      setBusy(false);
    }
  };

  return { subscribe, unsubscribe, busy, error };
}
