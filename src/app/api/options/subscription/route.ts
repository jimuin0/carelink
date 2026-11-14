/**
 * 有料オプションの契約状態と解約（2026年11月14日）。
 *   GET  /api/options/subscription?facilityId=... … 自店の PAY.JP 定期課金の状態（option_key・status・current_period_end）
 *   POST /api/options/subscription  body: { facilityId, optionKey } … 期間末で解約する
 *
 * PAY.JP 側の ID は service_role 専用の表（facility_option_payjp_subscriptions）にあるので、ここで読み書きする。
 * 解約は即時ではなく期間末（PAY.JP の cancel）。支払い済みの期間末までは使え、期間末に subscription.deleted の
 * webhook が entitlement を canceled にする（src/lib/options-payjp.ts）。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute, serverError } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { UUID_REGEX } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { cancelSubscription } from '@/lib/payjp';
import { PAYJP_UNAVAILABLE_MESSAGE } from '@/lib/payjp-customer';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/options/subscription';
/** 解約できる状態（課金中・試用・支払い停止中）。canceled は解約予約済み、deleted は終了済み。 */
const CANCELABLE = ['active', 'trial', 'paused'];

type Admin = ReturnType<typeof createServiceRoleClient>;

async function isManager(admin: Admin, userId: string, facilityId: string) {
  const { data, error } = await admin.from('facility_members').select('role')
    .eq('facility_id', facilityId).eq('user_id', userId).in('role', ['owner', 'admin']).maybeSingle();
  return { ok: !!data, error };
}

export async function GET(request: Request) {
  return withRoute(async (req, ctx) => {
    const facilityId = new URL(req.url).searchParams.get('facilityId');
    if (!facilityId || !UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    const admin = createServiceRoleClient();
    const member = await isManager(admin, ctx.user!.id, facilityId);
    if (member.error) return serverError('options-subscription-membership', member.error, ROUTE);
    if (!member.ok) return NextResponse.json({ error: 'この施設の管理権限がありません' }, { status: 403 });
    const { data, error } = await admin.from('facility_option_payjp_subscriptions')
      .select('option_key, status, current_period_end').eq('facility_id', facilityId);
    if (error) return serverError('options-subscription-list', error, ROUTE);
    return NextResponse.json({ subscriptions: data ?? [] });
  }, { csrf: false, requireAuth: true, rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'options-subscription-get' }, sentryTag: 'options-subscription-get' })(request);
}

const cancelSchema = z.object({
  facilityId: z.string().regex(UUID_REGEX),
  optionKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
}).strict();

export async function POST(request: Request) {
  return withRoute(async (req, ctx) => {
    const parsed = cancelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    const { facilityId, optionKey } = parsed.data;
    const admin = createServiceRoleClient();
    const member = await isManager(admin, ctx.user!.id, facilityId);
    if (member.error) return serverError('options-subscription-membership', member.error, ROUTE);
    if (!member.ok) return NextResponse.json({ error: 'この施設の管理権限がありません' }, { status: 403 });

    const { data: row, error: rowErr } = await admin.from('facility_option_payjp_subscriptions')
      .select('payjp_subscription_id, status').eq('facility_id', facilityId).eq('option_key', optionKey).maybeSingle();
    if (rowErr) return serverError('options-subscription-read', rowErr, ROUTE);
    if (!row?.payjp_subscription_id || !CANCELABLE.includes(row.status)) {
      return NextResponse.json({ error: '解約できる契約がありません（解約予約済み・終了済みを含む）' }, { status: 409 });
    }

    let periodEnd: string | null = null;
    try {
      const sub = await cancelSubscription(row.payjp_subscription_id);
      periodEnd = typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000).toISOString() : null;
    } catch (err) {
      return serverError('options-subscription-cancel', err, ROUTE, PAYJP_UNAVAILABLE_MESSAGE);
    }
    // PAY.JP 側の解約は済んでいる。表示用の状態だけ先に canceled にする（subscription.canceled の webhook でも同じになる）。
    const { error: markErr } = await admin.from('facility_option_payjp_subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('facility_id', facilityId).eq('option_key', optionKey);
    if (markErr) return serverError('options-subscription-mark', markErr, ROUTE, '解約は受け付けましたが、表示の更新に失敗しました。しばらくしてから再読み込みしてください。');

    const { ip, ua } = getRequestContext(req);
    void writeAuditLog({
      action: 'cancel', tableName: 'facility_option_payjp_subscriptions', recordId: `${facilityId}:${optionKey}`, userId: ctx.user!.id, facilityId,
      newValues: { option_key: optionKey, payjp_subscription_id: row.payjp_subscription_id, cancel_at_period_end: true }, ipAddress: ip, userAgent: ua,
    });
    return NextResponse.json({ canceled: true, periodEnd });
  }, { csrf: true, requireAuth: true, rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'options-subscription-cancel' }, sentryTag: 'options-subscription-cancel' })(request);
}
