/**
 * 有料オプション（施設向け月額）の申込（POST /api/options/checkout・2026年11月14日に Stripe から PAY.JP へ移行）。
 *   body: { facilityId, optionKey, token }
 *   token は payjp.js が作ったカードのトークン（tok_...）。カード番号はサーバーを通らない。
 *
 * CareLink → 施設 への課金。施設ごとの PAY.JP customer（広告枠と共用）にカードを登録し、
 * オプションの税込月額と同じ PAY.JP プラン（無ければ作る）で定期課金を作る。
 * entitlement の有効化・無効化は定期課金の状態で決める（申込の応答と webhook の subscription.* の両方から
 * applyOptionSubscription が反映する）。施設 × オプションで契約は 1 件まで（二重課金を作らない）。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute, serverError } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { alertCaughtError } from '@/lib/alert';
import { UUID_REGEX } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { isPaymentsEnabled } from '@/lib/integration-availability';
import { createSubscription, isCardError } from '@/lib/payjp';
import { CARD_REJECTED_MESSAGE, PAYJP_UNAVAILABLE_MESSAGE, ensureFacilityCustomer } from '@/lib/payjp-customer';
import { applyOptionSubscription, ensureOptionPlan } from '@/lib/options-payjp';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/options/checkout';
/** 申込の途中で止まった pending は、この時間を過ぎたら新しい申込の妨げにしない。 */
const PENDING_BLOCK_MS = 30 * 60 * 1000;

const bodySchema = z.object({
  facilityId: z.string().regex(UUID_REGEX),
  optionKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
  token: z.string().regex(/^tok_[A-Za-z0-9]{1,100}$/),
}).strict();

export async function POST(request: Request) {
  return withRoute(async (req, ctx) => {
    if (!isPaymentsEnabled()) return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    const { facilityId, optionKey, token } = parsed.data;
    const admin = createServiceRoleClient();

    // 施設の owner/admin のみ購入可能（IDOR 防止）。DB 障害は「権限なし」に化けさせない。
    const { data: membership, error: membershipError } = await admin
      .from('facility_members').select('role')
      .eq('facility_id', facilityId).eq('user_id', ctx.user!.id).in('role', ['owner', 'admin']).maybeSingle();
    if (membershipError) return serverError('options-checkout-membership', membershipError, ROUTE);
    if (!membership) return NextResponse.json({ error: 'この施設の管理権限がありません' }, { status: 403 });

    // カタログからサーバ側で価格決定（クライアント渡し価格は信用しない）
    const { data: option, error: optionError } = await admin
      .from('option_catalog').select('key, name, monthly_price, contact_only, is_active').eq('key', optionKey).maybeSingle();
    if (optionError) return serverError('options-checkout-catalog', optionError, ROUTE);
    if (!option || !option.is_active) return NextResponse.json({ error: 'オプションが見つかりません' }, { status: 404 });
    if (option.contact_only) return NextResponse.json({ error: 'このオプションはお申込み（個別対応）専用です' }, { status: 400 });
    if (option.monthly_price < 50) return NextResponse.json({ error: '価格が未設定のため購入できません' }, { status: 400 });

    // 契約中・支払い停止中・期間末解約待ち・申込処理中があれば作らない（二重課金の防止）。
    const { data: current, error: currentErr } = await admin
      .from('facility_option_payjp_subscriptions').select('status, created_at')
      .eq('facility_id', facilityId).eq('option_key', optionKey).maybeSingle();
    if (currentErr) return serverError('options-checkout-current', currentErr, ROUTE);
    if (current && ['active', 'trial', 'paused', 'canceled'].includes(current.status)) {
      return NextResponse.json({ error: 'このオプションは既にご利用中です' }, { status: 409 });
    }
    if (current?.status === 'pending' && Date.now() - new Date(current.created_at).getTime() < PENDING_BLOCK_MS) {
      return NextResponse.json({ error: 'お申し込みを処理中です。しばらくしてから画面を再読み込みしてください。' }, { status: 409 });
    }

    let planId: string;
    try {
      planId = (await ensureOptionPlan(option.key, option.monthly_price, option.name)).id;
    } catch (err) {
      return serverError('options-checkout-plan', err, ROUTE, PAYJP_UNAVAILABLE_MESSAGE);
    }

    const customer = await ensureFacilityCustomer(admin, facilityId, token);
    if (!customer.ok) {
      if (customer.reason === 'card') return NextResponse.json({ error: CARD_REJECTED_MESSAGE }, { status: 400 });
      return serverError(`options-checkout-${customer.tag}`, customer.error, ROUTE, PAYJP_UNAVAILABLE_MESSAGE);
    }

    const now = new Date().toISOString();
    const { error: linkErr } = await admin.from('facility_option_payjp_subscriptions').upsert({
      facility_id: facilityId, option_key: optionKey, payjp_customer_id: customer.customerId,
      payjp_subscription_id: null, status: 'pending', current_period_end: null, last_event_at: null,
      created_at: now, updated_at: now,
    }, { onConflict: 'facility_id,option_key' });
    if (linkErr) return serverError('options-checkout-link', linkErr, ROUTE);

    let subscription: Awaited<ReturnType<typeof createSubscription>>;
    try {
      subscription = await createSubscription(customer.customerId, planId, { facility_id: facilityId, option_key: optionKey });
    } catch (err) {
      // 定期課金は作られていない。pending を消して次の申込を妨げない。
      await admin.from('facility_option_payjp_subscriptions').delete()
        .eq('facility_id', facilityId).eq('option_key', optionKey).eq('status', 'pending');
      if (isCardError(err)) return NextResponse.json({ error: CARD_REJECTED_MESSAGE }, { status: 400 });
      return serverError('options-checkout-subscription', err, ROUTE, PAYJP_UNAVAILABLE_MESSAGE);
    }

    // 定期課金は作れた＝請求は始まっている。反映に失敗しても webhook（subscription.created）が
    // metadata で行を見つけて反映するので、利用者には成功を返し、運営にだけ知らせる。
    let active = false;
    try {
      await applyOptionSubscription(admin, 'subscription.created', subscription, new Date());
      active = subscription.status === 'active';
    } catch (err) {
      alertCaughtError('options-checkout-apply', err, ROUTE);
    }
    return NextResponse.json({ subscribed: true, active });
  }, { requireAuth: true, rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'options-checkout' }, sentryTag: 'options-checkout' })(request);
}
