'use client';

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

/**
 * この端末（ブラウザ）の Web Push 購読の登録・解除（2026年10月22日 共通化）。
 *
 * 予約者向けの PushPermissionBanner・マイページの設定と、店舗オーナー向けの管理画面（通知設定）が使う。
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

export type PushDeviceStatus =
  | { state: 'unsupported' }
  | { state: 'blocked' }
  | { state: 'signed_out' }
  | { state: 'registered' }
  | { state: 'unregistered'; otherDevice: boolean };

/**
 * この端末の通知の登録状況（店舗オーナーの通知設定と、お客様の予約完了画面・マイページで共通）。
 *
 * 「登録済み」は【このブラウザの購読の endpoint とサーバーの行が一致し、通知が許可されている】ときだけ。
 * ブラウザの許可（Notification.permission）だけでは判定しない：許可済みでもサーバーの行が
 * 失効の後始末で消えていたり、別の端末の登録に置き換わっていたりすると、通知は届かない
 * （以前の予約完了バナーは許可済みなら二度と出ず、登録し直す手段が無かった）。
 * ログインしていなければ 'signed_out'（サーバーへ保存できないので登録させない）。
 * サーバーの行を読めなかったときは例外。
 */
export async function readThisDevicePushStatus(): Promise<PushDeviceStatus> {
  if (!isPushSupported()) return { state: 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'blocked' };
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { state: 'signed_out' };
  const local = await readThisDeviceEndpoint();
  // 本人の行だけが読める（RLS push_subscriptions_owner_all）。
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (local && data?.endpoint === local && Notification.permission === 'granted') return { state: 'registered' };
  return { state: 'unregistered', otherDevice: Boolean(data) };
}

/**
 * Service Worker の準備を待つ上限。`navigator.serviceWorker.ready` は登録が無いと永久に解決しない
 * （public/sw-register.js は登録失敗を握り潰す）。待ち続けると登録ボタンが「登録中...」のまま
 * 押せなくなり、エラーも再試行の手段も出ないため、上限を過ぎたら失敗として扱う。
 * 登録自体は layout の lazyOnload で少し遅れて始まるので、その分の余裕は持たせる。
 */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

/** Service Worker の準備ができた登録を返す。上限までに準備できなければ null。 */
async function waitForServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 'signed_out' ＝サーバーがログインを確認できなかった（401）。時間をおいても直らないので、失敗とは分けて案内する。 */
export type SubscribeOutcome = 'subscribed' | 'denied' | 'failed' | 'signed_out';
export type UnsubscribeOutcome = 'unsubscribed' | 'failed';

/** 通知を許可してもらい、この端末を購読してサーバーへ保存する。保存に失敗したら 'failed'（成功に見せない）。 */
export async function subscribeThisDevice(): Promise<SubscribeOutcome> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return 'failed';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await waitForServiceWorker();
  if (!registration) return 'failed';
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
  if (res.status === 401) return 'signed_out';
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

/**
 * ログアウト・退会のときに、この端末の通知の後始末を待つ上限。
 * 後始末のせいでログアウトや退会の完了が止まらないようにする（上限を過ぎたら待たずに進む）。
 */
export const SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS = 5_000;

/**
 * ログアウト・退会のときに、この端末（ブラウザ）のプッシュ通知を外す（2026年10月23日 新設）。
 *
 * 🔴 なぜ必要か：以前はログアウトしても端末の購読も push_subscriptions の行も残り、
 * 共用の受付 PC などでログアウト後も「山田花子様から…の予約が入りました」のような
 * お客様の名前入りの通知が出続けた（送信側は user_id だけで宛先を決め、ログイン状態を見ない）。
 *
 * - `serverRow: true`（ログアウト）… まだログイン中のうちに、サーバーの行（本人かつこの端末の
 *   endpoint のものだけ）を消す。DELETE /api/push/subscribe は本人確認が要るので、
 *   signOut の【前】に呼ぶこと（後では 401 になる）。
 * - `serverRow: false`（退会後）… サーバーの行はアカウント削除と一緒に消える
 *   （push_subscriptions.user_id は auth.users を ON DELETE CASCADE）。ブラウザ側だけ外す。
 *
 * サーバー側の削除に失敗しても、ブラウザ側の購読は必ず外す。endpoint が失効するので、
 * 次の送信は 404/410 になり、送信側がサーバーの行を掃除する（＝この端末には二度と出ない）。
 * 例外は投げない。
 */
export async function releaseThisDevicePush({ serverRow }: { serverRow: boolean }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_PUSH_RELEASE_TIMEOUT_MS);
  });
  try {
    await Promise.race([releaseNow(serverRow), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function releaseNow(serverRow: boolean): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    if (serverRow) {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => null);
    }
    await subscription.unsubscribe().catch(() => false);
  } catch {
    // 後片付けなので、ここで失敗してもログアウト・退会は続ける。
  }
}

/** 登録・解除の実行状態（処理中・失敗）を持つフック。結果そのものは呼び出し側が受け取って扱う。 */
export function usePushSubscription() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'subscribe' | 'unsubscribe' | 'signed_out' | null>(null);

  const subscribe = async (): Promise<SubscribeOutcome> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await subscribeThisDevice();
      if (outcome === 'failed') setError('subscribe');
      if (outcome === 'signed_out') setError('signed_out');
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
