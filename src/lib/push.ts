import { createServiceRoleClient } from './supabase-server';

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
    // 410 Gone or 404 = subscription expired, clean up
    if (statusCode === 410 || statusCode === 404) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);
    }
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
