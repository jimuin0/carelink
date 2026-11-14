/**
 * 有料オプション（施設向け月額）の PAY.JP 定期課金を facility_entitlements へ反映する（2026年11月14日）。
 *
 * 以前は Stripe Checkout（mode=subscription）と Stripe webhook で有効化していた。PAY.JP へ移したので、
 * 申込（/api/options/checkout）が作った facility_option_payjp_subscriptions の行を、
 * subscription.* の webhook（/api/payjp/webhook）と申込直後の応答の両方からこの関数で反映する。
 *
 * 状態の読み方は広告枠と同じ（nextStateFor）。課金済みの期間（active・期間末解約待ちの canceled）は
 * entitlement を active、それ以外（paused・deleted・trial）は canceled にする。
 * 古いイベント（last_event_at より前）は反映しない。失敗は throw（webhook は 500 で再送させる）。
 */
import type { createServiceRoleClient } from './supabase-server';
import { nextStateFor } from './featured-ads-payjp';
import { createPlan, isNotFound, retrievePlan, type PayjpPlan } from './payjp';

type Admin = ReturnType<typeof createServiceRoleClient>;

export type OptionSubscriptionSnapshot = {
  id: string;
  status: unknown;
  current_period_end?: unknown;
  metadata?: unknown;
};

/** PAY.JP のプラン ID（オプションと税込月額で一意。値段を変えたら別のプランになる）。 */
export function optionPlanId(optionKey: string, monthlyPrice: number): string {
  return `carelink_option_${optionKey}_${monthlyPrice}`;
}

/** オプションの月額プランを取り出し、無ければ作る。既存のプランが値段と食い違えば throw（売らない）。 */
export async function ensureOptionPlan(optionKey: string, monthlyPrice: number, name: string): Promise<PayjpPlan> {
  const planId = optionPlanId(optionKey, monthlyPrice);
  let plan: PayjpPlan;
  try {
    plan = await retrievePlan(planId);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    plan = await createPlan(planId, monthlyPrice, `CareLink オプション: ${name}`.slice(0, 64));
  }
  if (plan.amount !== monthlyPrice || plan.currency !== 'jpy' || plan.interval !== 'month') {
    throw new Error(`PAY.JP plan ${planId} is ${plan.amount} ${plan.currency}/${plan.interval}, expected ${monthlyPrice} jpy/month`);
  }
  return plan;
}

export type OptionApplyOutcome = 'applied' | 'ignored' | 'stale';

export async function applyOptionSubscription(
  admin: Admin,
  type: string,
  sub: OptionSubscriptionSnapshot,
  eventAt: Date,
): Promise<OptionApplyOutcome> {
  const next = nextStateFor(type, sub.status);
  if (!next) return 'ignored';
  const metadata = (sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {}) as Record<string, unknown>;

  const byId = await admin.from('facility_option_payjp_subscriptions')
    .select('facility_id, option_key, payjp_subscription_id, last_event_at')
    .eq('payjp_subscription_id', sub.id).maybeSingle();
  if (byId.error) throw new Error(`facility_option_payjp_subscriptions lookup failed: ${byId.error.message}`);
  let link = byId.data;
  if (!link && typeof metadata.facility_id === 'string' && typeof metadata.option_key === 'string') {
    // 申込直後で ID の保存より webhook が先に届いた場合は metadata で探す（別の定期課金に紐づいた行は書き換えない）。
    const byKey = await admin.from('facility_option_payjp_subscriptions')
      .select('facility_id, option_key, payjp_subscription_id, last_event_at')
      .eq('facility_id', metadata.facility_id).eq('option_key', metadata.option_key).maybeSingle();
    if (byKey.error) throw new Error(`facility_option_payjp_subscriptions lookup failed: ${byKey.error.message}`);
    if (byKey.data && (byKey.data.payjp_subscription_id === null || byKey.data.payjp_subscription_id === sub.id)) {
      link = byKey.data;
    }
  }
  if (!link) throw new Error(`no option subscription row for PAY.JP subscription ${sub.id}`);
  if (link.last_event_at && new Date(link.last_event_at).getTime() > eventAt.getTime()) return 'stale';

  const periodEnd = typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const now = new Date().toISOString();
  const ent = await admin.from('facility_entitlements').upsert({
    facility_id: link.facility_id,
    option_key: link.option_key,
    status: next.isActive ? 'active' : 'canceled',
    current_period_end: periodEnd,
    updated_at: now,
  }, { onConflict: 'facility_id,option_key' });
  if (ent.error) throw new Error(`facility_entitlements upsert failed: ${ent.error.message}`);

  const upd = await admin.from('facility_option_payjp_subscriptions').update({
    payjp_subscription_id: sub.id,
    status: next.status,
    current_period_end: periodEnd,
    last_event_at: eventAt.toISOString(),
    updated_at: now,
  }).eq('facility_id', link.facility_id).eq('option_key', link.option_key).select('facility_id');
  if (upd.error) throw new Error(`facility_option_payjp_subscriptions update failed: ${upd.error.message}`);
  if (!upd.data || upd.data.length !== 1) throw new Error(`facility_option_payjp_subscriptions update matched 0 rows (${link.facility_id}/${link.option_key})`);
  return 'applied';
}
