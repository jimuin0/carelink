/**
 * 広告枠（検索結果上位表示）の一覧・申込・解約（2026年11月13日・点検 B2-1 で PAY.JP の月額サブスクに作り直し）。
 *
 * 以前は Stripe Checkout で期間に関係なく 9,800 円を 1 回だけ請求していた。今は：
 *   GET    … 自店の枠と、販売できるか（isPayjpEnabled）・税込月額・payjp.js の公開鍵を返す。
 *   POST   … payjp.js が作ったカードのトークンで施設の customer を作り（既にあればカードを差し替え）、
 *            定期課金を作る。枠は is_active=false の「有効化待ち」で作り、掲載の開始・停止は webhook
 *            （/api/payjp/webhook）が決める。カード番号はサーバーを通らない。
 *   DELETE … 期間末で解約する（期間末までは掲載し、subscription.deleted で止まる）。
 * PAY.JP の 4 つの設定が揃っていなければ、販売に関わる操作は 404（販売停止中と同じ見え方）。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError, withRoute } from '@/lib/with-route';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { alertCaughtError } from '@/lib/alert';
import { UUID_REGEX } from '@/lib/constants';
import { isPayjpEnabled } from '@/lib/integration-availability';
import {
  FEATURED_AD_PRICE_TAX_EXCLUDED, FEATURED_AD_PRICE_TAX_INCLUDED,
  addDefaultCard, cancelSubscription, createCustomer, createSubscription, isCardError,
  planMatchesFeaturedPrice, retrievePlan,
} from '@/lib/payjp';

const ROUTE = '/api/admin/featured-ads';
const NOT_ON_SALE = { error: '有料掲載枠のお申し込みは現在受け付けておりません' };
const CARD_REJECTED = 'カードを利用できませんでした。カード情報を確かめるか、別のカードでお試しください。';
/** 申込の途中で止まった「有効化待ち」を、この時間を過ぎたら新しい申込の妨げにしない。 */
const PENDING_BLOCK_MS = 30 * 60 * 1000;

type Admin = ReturnType<typeof createServiceRoleClient>;

/** 所属を確かめる。DB 障害は「所属なし」に化けさせず error として返す（中 A9）。 */
async function verifyFacilityMembership(admin: Admin, userId: string, facilityId: string): Promise<{ member: boolean; error: unknown }> {
  const { data, error } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .maybeSingle();
  if (error) return { member: false, error };
  return { member: data !== null, error: null };
}

export async function GET(request: Request) {
  return withRoute(async (req, ctx) => {
    const facilityId = new URL(req.url).searchParams.get('facility_id');
    if (!facilityId || !UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
    const admin = createServiceRoleClient();
    const membership = await verifyFacilityMembership(admin, ctx.user!.id, facilityId);
    if (membership.error) return serverError('admin-featured-ads-membership', membership.error, ROUTE);
    if (!membership.member) return NextResponse.json({ error: 'No facility' }, { status: 403 });

    const { data: slots, error: slotsErr } = await admin
      .from('featured_slots')
      .select('id, slot_type, area, business_type, starts_at, ends_at, budget_yen, impressions, clicks, is_active')
      .eq('facility_id', facilityId)
      .order('starts_at', { ascending: false });
    if (slotsErr) return serverError('admin-featured-ads-list', slotsErr, ROUTE, 'サーバーエラーが発生しました', { slots: [] });

    const { data: billing, error: billingErr } = await admin
      .from('featured_slot_payjp_subscriptions')
      .select('slot_id, status, current_period_end')
      .eq('facility_id', facilityId);
    if (billingErr) return serverError('admin-featured-ads-billing', billingErr, ROUTE, 'サーバーエラーが発生しました', { slots: [] });
    const billingBySlot = new Map((billing ?? []).map((b) => [b.slot_id, b]));

    const enabled = isPayjpEnabled();
    return NextResponse.json({
      slots: (slots ?? []).map((s) => ({
        ...s,
        billing_status: billingBySlot.get(s.id)?.status ?? null,
        current_period_end: billingBySlot.get(s.id)?.current_period_end ?? null,
      })),
      sales: enabled
        ? {
          enabled: true,
          publicKey: process.env.NEXT_PUBLIC_PAYJP_PUBLIC_KEY,
          priceTaxExcluded: FEATURED_AD_PRICE_TAX_EXCLUDED,
          priceTaxIncluded: FEATURED_AD_PRICE_TAX_INCLUDED,
        }
        : { enabled: false },
    });
  }, { csrf: false, requireAuth: true, rateLimit: { limiter: null, limit: 20, windowMs: 60_000, prefix: 'featured-ads-get' }, sentryTag: 'admin-featured-ads-get' })(request);
}

const createSchema = z.object({
  facility_id: z.string().regex(UUID_REGEX),
  // payjp.js の createToken が返すトークン ID（tok_...）。カード番号そのものは受け取らない。
  token: z.string().regex(/^tok_[A-Za-z0-9]{1,100}$/),
  area: z.string().trim().max(50).optional().nullable(),
  business_type: z.string().trim().max(50).optional().nullable(),
}).strict();

export async function POST(request: Request) {
  return withRoute(async (req, ctx) => {
    if (!isPayjpEnabled()) return NextResponse.json(NOT_ON_SALE, { status: 404 });
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '入力内容が正しくありません' }, { status: 400 });
    const { facility_id: facilityId, token } = parsed.data;
    const area = parsed.data.area || null;
    const businessType = parsed.data.business_type || null;
    const userId = ctx.user!.id;

    const admin = createServiceRoleClient();
    const membership = await verifyFacilityMembership(admin, userId, facilityId);
    if (membership.error) return serverError('admin-featured-ads-membership', membership.error, ROUTE);
    if (!membership.member) return NextResponse.json({ error: 'No facility' }, { status: 403 });

    // 1 店舗 1 契約。契約中・支払い停止中・期間末解約待ち・申込処理中があれば新しく作らない（二重課金の防止）。
    const { data: current, error: currentErr } = await admin
      .from('featured_slot_payjp_subscriptions')
      .select('status, created_at')
      .eq('facility_id', facilityId)
      .in('status', ['pending', 'active', 'trial', 'paused', 'canceled']);
    if (currentErr) return serverError('admin-featured-ads-current', currentErr, ROUTE);
    const blocking = (current ?? []).filter((c) => c.status !== 'pending' || Date.now() - new Date(c.created_at).getTime() < PENDING_BLOCK_MS);
    if (blocking.length > 0) {
      return NextResponse.json({ error: 'この店舗にはすでに広告枠の契約があります。' }, { status: 409 });
    }

    // 画面の税込月額と PAY.JP のプラン金額が食い違っていたら売らない（設定の誤り＝運営に通知）。
    const planId = process.env.PAYJP_FEATURED_PLAN_ID!;
    try {
      const plan = await retrievePlan(planId);
      if (!planMatchesFeaturedPrice(plan)) {
        return serverError('admin-featured-ads-plan-mismatch',
          new Error(`PAY.JP plan ${planId} is ${plan.amount} ${plan.currency}/${plan.interval}, expected ${FEATURED_AD_PRICE_TAX_INCLUDED} jpy/month`),
          ROUTE, '決済設定に誤りがあるため申し込めません。運営にお問い合わせください。');
      }
    } catch (err) {
      return serverError('admin-featured-ads-plan', err, ROUTE, '決済サービスに接続できませんでした。時間をおいて再度お試しください。');
    }

    // 施設ごとの customer。既にあればカードを差し替え、無ければ作る。
    const { data: customerRow, error: customerErr } = await admin
      .from('facility_payjp_customers').select('payjp_customer_id').eq('facility_id', facilityId).maybeSingle();
    if (customerErr) return serverError('admin-featured-ads-customer-read', customerErr, ROUTE);
    let customerId = customerRow?.payjp_customer_id ?? null;
    try {
      if (customerId) {
        await addDefaultCard(customerId, token);
      } else {
        customerId = (await createCustomer(token, facilityId)).id;
        const { error: saveErr } = await admin.from('facility_payjp_customers').insert({ facility_id: facilityId, payjp_customer_id: customerId });
        if (saveErr) {
          return serverError('admin-featured-ads-customer-save', new Error(`${saveErr.message} (orphan PAY.JP customer ${customerId})`), ROUTE);
        }
      }
    } catch (err) {
      if (isCardError(err)) return NextResponse.json({ error: CARD_REJECTED }, { status: 400 });
      return serverError('admin-featured-ads-customer', err, ROUTE, '決済サービスに接続できませんでした。時間をおいて再度お試しください。');
    }

    const now = new Date().toISOString();
    const { data: slot, error: slotErr } = await admin.from('featured_slots').insert({
      facility_id: facilityId,
      slot_type: 'search_top',
      area,
      business_type: businessType,
      starts_at: now,
      ends_at: now, // 掲載期間は webhook が課金期間の終わりまで延ばす
      budget_yen: FEATURED_AD_PRICE_TAX_INCLUDED,
      is_active: false, // 有効化待ち。subscription.created（active）で掲載が始まる
    }).select('id, slot_type, area, business_type, starts_at, ends_at, budget_yen, impressions, clicks, is_active').single();
    if (slotErr || !slot) return serverError('admin-featured-ads-create', slotErr ?? new Error('slot insert returned no row'), ROUTE);

    const discardSlot = async () => {
      // 課金できなかった枠は誰も支払っていない。未有効のまま残さず消す（ON DELETE CASCADE で決済の行も消える）。
      const { error } = await admin.from('featured_slots').delete().eq('id', slot.id).eq('is_active', false);
      if (error) console.error('[featured-ads] orphan slot cleanup failed', { slotId: slot.id });
    };
    const { error: linkErr } = await admin.from('featured_slot_payjp_subscriptions').insert({
      slot_id: slot.id, facility_id: facilityId, payjp_customer_id: customerId, status: 'pending',
    });
    if (linkErr) {
      await discardSlot();
      return serverError('admin-featured-ads-link', linkErr, ROUTE);
    }

    let subscriptionId: string;
    try {
      subscriptionId = (await createSubscription(customerId, planId, { slot_id: slot.id, facility_id: facilityId })).id;
    } catch (err) {
      await discardSlot();
      if (isCardError(err)) return NextResponse.json({ error: CARD_REJECTED }, { status: 400 });
      return serverError('admin-featured-ads-subscription', err, ROUTE, '決済サービスに接続できませんでした。時間をおいて再度お試しください。');
    }

    // 定期課金は作れた＝請求は始まっている。ID の保存に失敗しても webhook が metadata.slot_id で
    // 枠を見つけて反映するので、利用者には成功を返し、運営にだけ知らせる。
    const { error: saveSubErr } = await admin.from('featured_slot_payjp_subscriptions')
      .update({ payjp_subscription_id: subscriptionId, updated_at: new Date().toISOString() }).eq('slot_id', slot.id);
    if (saveSubErr) {
      alertCaughtError('admin-featured-ads-subscription-save', new Error(`${saveSubErr.message} (slot_id=${slot.id}, subscription=${subscriptionId})`), ROUTE);
    }

    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({
      userId, facilityId, action: 'create', tableName: 'featured_slots', recordId: slot.id,
      newValues: { slot_type: 'search_top', area, business_type: businessType, payjp_subscription_id: subscriptionId, monthly_yen: FEATURED_AD_PRICE_TAX_INCLUDED },
      ipAddress: ip, userAgent: ua,
    });
    return NextResponse.json({ slot: { ...slot, billing_status: 'pending', current_period_end: null } }, { status: 201 });
  }, { requireAuth: true, rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'featured-ads' }, sentryTag: 'admin-featured-ads-post' })(request);
}

export async function DELETE(request: Request) {
  return withRoute(async (req, ctx) => {
    if (!isPayjpEnabled()) return NextResponse.json(NOT_ON_SALE, { status: 404 });
    const params = new URL(req.url).searchParams;
    const facilityId = params.get('facility_id');
    const slotId = params.get('slot_id');
    if (!facilityId || !slotId || !UUID_REGEX.test(facilityId) || !UUID_REGEX.test(slotId)) {
      return NextResponse.json({ error: '店舗・広告枠IDが不正です' }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    const membership = await verifyFacilityMembership(admin, ctx.user!.id, facilityId);
    if (membership.error) return serverError('admin-featured-ads-membership', membership.error, ROUTE);
    if (!membership.member) return NextResponse.json({ error: 'No facility' }, { status: 403 });

    const { data: link, error: linkErr } = await admin.from('featured_slot_payjp_subscriptions')
      .select('payjp_subscription_id, status').eq('slot_id', slotId).eq('facility_id', facilityId).maybeSingle();
    if (linkErr) return serverError('admin-featured-ads-cancel-read', linkErr, ROUTE);
    if (!link?.payjp_subscription_id || !['active', 'trial', 'paused'].includes(link.status)) {
      return NextResponse.json({ error: '解約できる契約が見つかりません' }, { status: 404 });
    }
    try {
      await cancelSubscription(link.payjp_subscription_id);
    } catch (err) {
      return serverError('admin-featured-ads-cancel', err, ROUTE, '解約できませんでした。時間をおいて再度お試しください。');
    }
    // 状態の正は webhook（subscription.canceled）。ここでは画面がすぐ「解約予約済み」を出せるよう先に記録する。
    const { error: markErr } = await admin.from('featured_slot_payjp_subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('slot_id', slotId);
    if (markErr) alertCaughtError('admin-featured-ads-cancel-mark', markErr, ROUTE);

    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({
      userId: ctx.user!.id, facilityId, action: 'cancel', tableName: 'featured_slots', recordId: slotId,
      newValues: { payjp_subscription_id: link.payjp_subscription_id, cancel_at_period_end: true }, ipAddress: ip, userAgent: ua,
    });
    return NextResponse.json({ ok: true });
  }, { requireAuth: true, rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'featured-ads-cancel' }, sentryTag: 'admin-featured-ads-delete' })(request);
}
