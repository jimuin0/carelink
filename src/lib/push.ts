import { createServiceRoleClient } from './supabase-server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = 'mailto:support@carelink-jp.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
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
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;

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
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

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
