import { createServiceRoleClient } from './supabase-server';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';
import { channelDeliveryResult, type ChannelDeliveryResult } from './channel-delivery-result';

const VAPID_SUBJECT = 'mailto:support@carelink-jp.com';
let vapidConfigured = false;

function getWebPush() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require('web-push');
  if (!vapidConfigured) {
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    /* istanbul ignore else */
    if (pub && priv) {
      webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
      vapidConfigured = true;
    } else {
      // 全呼び出し元は pub && priv を事前チェックするためここは到達不可（デッドコード）
      console.warn('[Push] VAPID keys not configured — push notifications disabled');
    }
  }
  return webpush;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type CapturedPushSubscription = { endpoint: string; p256dh: string; auth: string };

/**
 * Push サービスが「この購読はもう存在しない」と答えた状態（404 Not Found / 410 Gone）。
 * 端末側で通知を取り消した・サイトデータを消した・ブラウザを入れ直した等で起き、
 * 同じ宛先へ何度送り直しても届かない（＝再送しても無駄で、結果不明として保留してもいけない）。
 */
export function isExpiredPushStatus(status: number | null): boolean {
  return status === 404 || status === 410;
}

/**
 * 送信フェンスより前に、その利用者の端末の購読を読んで固定する。
 * 読めなかった（DB エラー）ときは例外＝まだ何も送っていないので、呼び出し側は安全に再試行できる。
 */
export async function readUserPushSubscription(userId: string): Promise<CapturedPushSubscription | null> {
  const { data, error } = await createServiceRoleClient()
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('PUSH_SUBSCRIPTION_READ_UNAVAILABLE');
  return data ?? null;
}

/**
 * 失効した購読の行を消す。消すのは【同じ利用者・同じ endpoint・同じ鍵】の行だけで、
 * 送信中にその利用者が登録し直した新しい端末の行は残す。
 * 後片付けなので例外は投げない（失敗しても次の送信でもう一度 404/410 になり、また消しに来る）。
 */
export async function removeExpiredPushSubscription(userId: string, subscription: CapturedPushSubscription): Promise<boolean> {
  try {
    const { error } = await createServiceRoleClient()
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint)
      .eq('p256dh', subscription.p256dh)
      .eq('auth', subscription.auth);
    if (error) {
      console.error('[push] expired subscription cleanup failed', { userId });
      return false;
    }
    return true;
  } catch {
    console.error('[push] expired subscription cleanup failed', { userId });
    return false;
  }
}

/** Capture one endpoint before the DB send fence. No recipient lookup, cleanup,
 * retry, or raw provider error logging occurs in this one-attempt transport. */
export function prepareCapturedPushDelivery(subscription: CapturedPushSubscription,
  payload: PushPayload): () => Promise<ChannelDeliveryResult> {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('PUSH_PREPARATION_UNAVAILABLE');
  const webpush = getWebPush();
  const captured = { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
  const message = JSON.stringify(payload);
  try { webpush.generateRequestDetails(captured, message); }
  catch { throw new Error('PUSH_PREPARATION_UNAVAILABLE'); }
  return async () => {
    try {
      const result = await webpush.sendNotification(captured, message, { timeout: 10000 });
      return channelDeliveryResult(result?.statusCode);
    } catch (error) {
      const result = channelDeliveryResult(typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : null);
      return result.outcome === 'delivered' ? { outcome: 'uncertain', status: result.status } : result;
    }
  };
}

/**
 * Send push notification to a specific user.
 * Silently skips if VAPID keys are not configured or user has no subscription.
 * Removes stale subscriptions (410 Gone).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;

  const webpush = getWebPush();
  const supabase = createServiceRoleClient();
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
    .maybeSingle();

  if (!sub) return false;

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return true;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    // 410 Gone or 404 = subscription expired, clean up（想定内の失効・アラート不要）
    if (statusCode === 410 || statusCode === 404) {
      await removeExpiredPushSubscription(userId, sub);
      return false;
    }
    // 410/404 以外（VAPID鍵不整合・ネットワーク障害・push サービス側 5xx 等）は想定外の失敗のため
    // 可視化する。従来は catch 内で false を返すのみで console.error すら出ず、呼び出し元の
    // `.catch()` も（例外を再送出しないため）発火せず完全無音だった。
    safeCaptureException(err, 'push-send');
    alertCaughtError('push-send', err, `push:user:${userId}`);
    return false;
  }
}

/**
 * Send push notification to all subscribers of a facility (owners/admins).
 */
export async function sendPushToFacilityOwners(facilityId: string, payload: PushPayload): Promise<void> {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  const supabase = createServiceRoleClient();
  const { data: members } = await supabase
    .from('facility_members')
    .select('user_id')
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin']);

  if (!members || members.length === 0) return;

  await Promise.allSettled(
    members.map((m) => sendPushToUser(m.user_id, payload))
  );
}
