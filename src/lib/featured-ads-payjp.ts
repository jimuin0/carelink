/**
 * PAY.JP webhook のイベントを広告枠（featured_slots）の状態へ反映する（2026年11月13日・点検 B2-1）。
 *
 * route.ts は HTTP メソッド以外を export できないため、判定と DB 反映はここに置く。
 *
 * 反映の規則（https://docs.pay.jp/v1/subscription の課金の流れに合わせる）：
 *   - subscription.created / renewed / resumed / updated … data.status をそのまま反映。
 *     'active' なら掲載（is_active=true）、課金期間の終わり＋猶予まで ends_at を延ばす。
 *   - subscription.paused   … 更新時の課金失敗（charge.failed と同時に届く）。掲載を止める。
 *   - subscription.canceled … 期間末での解約予約。支払い済みの期間末までは掲載し、猶予は付けない。
 *   - subscription.deleted  … 契約終了。掲載を止める。
 *   - それ以外（charge.* など）… 何もしない（定期課金の状態は subscription.* だけで決まる）。
 *
 * 失敗（DB 障害・対応する枠が見つからない）は throw する。webhook は 500 を返し、PAY.JP の再送で処理し直す。
 * 古いイベント（すでに新しいイベントを反映済み）は反映しない＝順序が入れ替わって届いても状態が巻き戻らない。
 */
import type { Database } from '@/types/database-overrides';
import type { createServiceRoleClient } from './supabase-server';
import { FEATURED_AD_RENEWAL_GRACE_MS, type PayjpSubscriptionStatus } from './payjp';

type Admin = ReturnType<typeof createServiceRoleClient>;

export type PayjpWebhookEvent = {
  id: string;
  type: string;
  created: number;
  data: Record<string, unknown>;
};

export type ApplyOutcome = 'applied' | 'ignored' | 'stale';

const STATUS_EVENTS = new Set(['subscription.created', 'subscription.renewed', 'subscription.resumed', 'subscription.updated']);
const SUBSCRIPTION_STATUSES: readonly PayjpSubscriptionStatus[] = ['active', 'trial', 'canceled', 'paused'];

/** 本文が PAY.JP のイベントの形か（id・type・created・data）。 */
export function parsePayjpEvent(value: unknown): PayjpWebhookEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(v.id)) return null;
  if (typeof v.type !== 'string' || v.type.length === 0 || v.type.length > 100) return null;
  if (typeof v.created !== 'number' || !Number.isFinite(v.created)) return null;
  if (!v.data || typeof v.data !== 'object') return null;
  return { id: v.id, type: v.type, created: v.created, data: v.data as Record<string, unknown> };
}

export type NextState = { status: 'active' | 'trial' | 'paused' | 'canceled' | 'deleted'; isActive: boolean; graceMs: number };

/** subscription.* イベントから、次の状態を決める（広告枠・有料オプションで共用）。対象外のイベントは null。 */
export function nextStateFor(type: string, dataStatus: unknown): NextState | null {
  if (type === 'subscription.paused') return { status: 'paused', isActive: false, graceMs: 0 };
  if (type === 'subscription.deleted') return { status: 'deleted', isActive: false, graceMs: 0 };
  if (type === 'subscription.canceled') return { status: 'canceled', isActive: true, graceMs: 0 };
  if (!STATUS_EVENTS.has(type)) return null;
  if (!SUBSCRIPTION_STATUSES.includes(dataStatus as PayjpSubscriptionStatus)) {
    throw new Error(`PAY.JP ${type} has an unknown subscription status: ${String(dataStatus)}`);
  }
  const status = dataStatus as PayjpSubscriptionStatus;
  return {
    status,
    // 試用期間（trial）はまだ課金されていない。このプランは試用期間を持たないが、来ても掲載しない。
    isActive: status === 'active' || status === 'canceled',
    graceMs: status === 'active' ? FEATURED_AD_RENEWAL_GRACE_MS : 0,
  };
}

export async function applyPayjpEvent(admin: Admin, event: PayjpWebhookEvent): Promise<ApplyOutcome> {
  const data = event.data;
  const next = nextStateFor(event.type, data.status);
  if (!next) return 'ignored';
  if (data.object !== 'subscription' || typeof data.id !== 'string') {
    throw new Error(`PAY.JP ${event.type} (${event.id}) does not carry a subscription object`);
  }
  const subscriptionId = data.id;
  const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;

  // 1) 定期課金 ID で探す。2) 申込直後で ID の保存より webhook が先に届いた場合は metadata.slot_id で探す。
  const byId = await admin.from('featured_slot_payjp_subscriptions')
    .select('slot_id, facility_id, payjp_subscription_id, last_event_at')
    .eq('payjp_subscription_id', subscriptionId).maybeSingle();
  if (byId.error) throw new Error(`featured_slot_payjp_subscriptions lookup failed: ${byId.error.message}`);
  let link = byId.data;
  if (!link && typeof metadata.slot_id === 'string') {
    const bySlot = await admin.from('featured_slot_payjp_subscriptions')
      .select('slot_id, facility_id, payjp_subscription_id, last_event_at')
      .eq('slot_id', metadata.slot_id).maybeSingle();
    if (bySlot.error) throw new Error(`featured_slot_payjp_subscriptions lookup failed: ${bySlot.error.message}`);
    // 別の定期課金に紐づいた枠を、metadata だけを根拠に書き換えない。
    if (bySlot.data && (bySlot.data.payjp_subscription_id === null || bySlot.data.payjp_subscription_id === subscriptionId)) {
      link = bySlot.data;
    }
  }
  if (!link) throw new Error(`no featured slot for PAY.JP subscription ${subscriptionId} (event ${event.id})`);
  if (typeof metadata.facility_id === 'string' && metadata.facility_id !== link.facility_id) {
    throw new Error(`PAY.JP subscription ${subscriptionId} metadata.facility_id does not match the slot`);
  }

  const eventAt = new Date(event.created * 1000);
  if (link.last_event_at && new Date(link.last_event_at).getTime() > eventAt.getTime()) return 'stale';

  const periodEnd = typeof data.current_period_end === 'number' ? new Date(data.current_period_end * 1000) : null;
  const slotUpdate: Database['public']['Tables']['featured_slots']['Update'] = { is_active: next.isActive };
  if (periodEnd) slotUpdate.ends_at = new Date(periodEnd.getTime() + next.graceMs).toISOString();
  if (next.status === 'deleted') slotUpdate.ends_at = eventAt.toISOString();

  const slot = await admin.from('featured_slots').update(slotUpdate).eq('id', link.slot_id).select('id');
  if (slot.error) throw new Error(`featured_slots update failed: ${slot.error.message} (slot_id=${link.slot_id})`);
  if (!slot.data || slot.data.length !== 1) throw new Error(`featured_slots update matched 0 rows (slot_id=${link.slot_id})`);

  const linkUpdate = await admin.from('featured_slot_payjp_subscriptions').update({
    payjp_subscription_id: subscriptionId,
    status: next.status,
    current_period_end: periodEnd ? periodEnd.toISOString() : null,
    last_event_at: eventAt.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('slot_id', link.slot_id).select('slot_id');
  if (linkUpdate.error) throw new Error(`featured_slot_payjp_subscriptions update failed: ${linkUpdate.error.message}`);
  if (!linkUpdate.data || linkUpdate.data.length !== 1) throw new Error(`featured_slot_payjp_subscriptions update matched 0 rows (slot_id=${link.slot_id})`);
  return 'applied';
}
