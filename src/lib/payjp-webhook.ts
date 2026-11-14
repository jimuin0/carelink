/**
 * PAY.JP webhook のイベントを、対象ごとの反映処理へ振り分ける（2026年11月14日）。
 *   - subscription.* で metadata.option_key がある → 有料オプション（options-payjp）
 *   - それ以外の subscription.* → 広告枠（featured-ads-payjp）
 *   - charge.succeeded / charge.refunded / dispute.created → 予約の前払い（booking-payjp）
 *   - それ以外 → 何もしない
 */
import type { createServiceRoleClient } from './supabase-server';
import { applyPayjpEvent, type PayjpWebhookEvent } from './featured-ads-payjp';
import { applyOptionSubscription } from './options-payjp';
import { applyBookingChargeEvent } from './booking-payjp';

type Admin = ReturnType<typeof createServiceRoleClient>;
export type WebhookOutcome = 'applied' | 'ignored' | 'stale';

export async function applyPayjpWebhookEvent(admin: Admin, event: PayjpWebhookEvent): Promise<WebhookOutcome> {
  if (event.type.startsWith('subscription.')) {
    const metadata = (event.data.metadata && typeof event.data.metadata === 'object' ? event.data.metadata : {}) as Record<string, unknown>;
    if (typeof metadata.option_key === 'string') {
      if (event.data.object !== 'subscription' || typeof event.data.id !== 'string') {
        throw new Error(`PAY.JP ${event.type} (${event.id}) does not carry a subscription object`);
      }
      return applyOptionSubscription(admin, event.type, {
        id: event.data.id,
        status: event.data.status,
        current_period_end: event.data.current_period_end,
        metadata,
      }, new Date(event.created * 1000));
    }
    return applyPayjpEvent(admin, event);
  }
  return applyBookingChargeEvent(admin, event);
}
