/**
 * 予約の前払い（オンライン決済）を PAY.JP で受ける（POST /api/payment/charge・2026年11月14日）。
 *
 * 以前は Stripe Checkout（/api/payment/checkout・/api/stripe/checkout の 2 本）だった。本人決定で PAY.JP に移し、1 本にまとめた。
 *   body: { bookingId, token, paymentType?: 'full' | 'deposit' }
 *   token は payjp.js が 3D セキュア付きで作ったカードのトークン（tok_...）。カード番号はサーバーを通らない。
 * 金額は DB の予約金額と店舗の前払い設定（deposit_type / deposit_amount）だけから決める。
 * 同じ予約に「処理中・支払い済み」の行は 1 行まで（uq_booking_payjp_charges_open）＝二重課金を作らない。
 * PAY.JP の結果が分からない（通信断など）ときは行を pending のまま残し、webhook（charge.succeeded）で照合する。
 * 前払いは「近日公開」で、利用者向けの導線はまだ無い（src/lib/coming-soon.ts）。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute, serverError } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { isPaymentsEnabled } from '@/lib/integration-availability';
import { SLOT_RELEASING_STATUSES, type BookingStatus } from '@/lib/booking-status';
import { createCharge, isCardError } from '@/lib/payjp';
import { CARD_REJECTED_MESSAGE, PAYJP_UNAVAILABLE_MESSAGE } from '@/lib/payjp-customer';
import { BOOKING_PAYMENT_TYPES, bookingPaymentAmount, markBookingPaymentPaid } from '@/lib/booking-payjp';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/payment/charge';

const bodySchema = z.object({
  bookingId: z.string().regex(UUID_REGEX),
  token: z.string().regex(/^tok_[A-Za-z0-9]{1,100}$/),
  paymentType: z.enum(BOOKING_PAYMENT_TYPES as [string, ...string[]]).optional(),
}).strict();

export async function POST(request: Request) {
  return withRoute(async (req, ctx) => {
    if (!isPaymentsEnabled()) return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    const { bookingId, token } = parsed.data;
    const paymentType = (parsed.data.paymentType ?? 'full') as 'full' | 'deposit';
    const userId = ctx.user!.id;
    const admin = createServiceRoleClient();

    const { data: booking, error: bookingErr } = await admin
      .from('bookings')
      .select('id, user_id, status, total_price, facility_id, payment_status')
      .eq('id', bookingId)
      .maybeSingle();
    if (bookingErr) return serverError('payment-charge-booking', bookingErr, ROUTE);
    if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (booking.user_id !== userId) return NextResponse.json({ error: 'この予約にアクセスする権限がありません' }, { status: 403 });
    // キャンセル済み・無断キャンセル等の予約には支払わせない（払っても施術は無く、返金の手当てが要る）。
    if (SLOT_RELEASING_STATUSES.includes(booking.status as BookingStatus)) {
      return NextResponse.json({ error: 'この予約はキャンセル済みのため支払いできません' }, { status: 409 });
    }
    if (booking.payment_status === 'paid') return NextResponse.json({ error: 'この予約は既に支払い済みです' }, { status: 409 });

    const { data: facility, error: facilityErr } = await admin
      .from('facility_profiles').select('name, deposit_type, deposit_amount').eq('id', booking.facility_id).maybeSingle();
    if (facilityErr) return serverError('payment-charge-facility', facilityErr, ROUTE);
    const amount = bookingPaymentAmount(booking.total_price, facility, paymentType);
    if (amount === null) return NextResponse.json({ error: 'この予約はオンラインで支払えません' }, { status: 400 });

    const { data: row, error: rowErr } = await admin.from('booking_payjp_charges').insert({
      booking_id: bookingId, facility_id: booking.facility_id, user_id: userId, amount, payment_type: paymentType, status: 'pending',
    }).select('id, booking_id, amount, payment_type, status').single();
    if (rowErr || !row) {
      if ((rowErr as { code?: string } | null)?.code === '23505') {
        return NextResponse.json({ error: 'この予約は支払いの処理中か、支払い済みです。予約詳細で状況を確かめてください。' }, { status: 409 });
      }
      return serverError('payment-charge-row', rowErr ?? new Error('insert returned no row'), ROUTE);
    }

    let chargeId: string;
    try {
      const facilityName = (facility?.name ?? 'CareLink').slice(0, 100);
      const charge = await createCharge(token, amount, `${facilityName} ${paymentType === 'deposit' ? 'デポジット' : '予約料金'}`, {
        payment_id: row.id, booking_id: bookingId, user_id: userId, payment_type: paymentType,
      });
      if (!charge.paid) throw new Error(`PAY.JP charge ${charge.id} is not paid`);
      chargeId = charge.id;
    } catch (err) {
      if (isCardError(err)) {
        // 支払いは作られていない。行を failed にして、次の申込を妨げない。
        await admin.from('booking_payjp_charges').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', row.id);
        return NextResponse.json({ error: CARD_REJECTED_MESSAGE }, { status: 400 });
      }
      // 結果が分からない。行は pending のまま残し、webhook の charge.succeeded で照合する（もう一度は課金させない）。
      return serverError('payment-charge-payjp', err, ROUTE, PAYJP_UNAVAILABLE_MESSAGE);
    }

    try {
      await markBookingPaymentPaid(admin, row, chargeId);
    } catch (err) {
      // 支払いは確定している。反映に失敗しても webhook が同じ行を paid にするので、利用者には成功を返して運営に知らせる。
      return serverError('payment-charge-record', new Error(`${err instanceof Error ? err.message : 'unknown'} (charge=${chargeId})`), ROUTE,
        'お支払いは完了しましたが、予約への反映に時間がかかっています。しばらくしてから予約詳細をご確認ください。');
    }
    return NextResponse.json({ paid: true, paymentId: row.id, amount });
  }, { requireAuth: true, rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'payment-charge' }, sentryTag: 'payment-charge' })(request);
}
