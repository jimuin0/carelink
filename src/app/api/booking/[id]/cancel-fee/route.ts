/**
 * キャンセル料 Stripe Checkout
 * POST /api/booking/[id]/cancel-fee
 * — キャンセルポリシーに基づいてキャンセル料を請求
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getTodayString } from '@/lib/validations-booking';

/** 'YYYY-MM-DD' を UTC 正午アンカーの epoch(ms) に変換（時刻成分・TZ・DST の影響を排除した純暦日表現） */
function dateToUtcNoon(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), 12);
}

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carelink-jp.com';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 5, 60_000, 'cancel-fee')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // Get booking
  const { data: booking } = await admin
    .from('bookings')
    .select('id, user_id, facility_id, booking_date, total_price, status, menu_name')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (booking.user_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  if (booking.status !== 'cancelled') return NextResponse.json({ error: 'キャンセルされた予約のみ対象です' }, { status: 400 });

  // Get cancellation policy
  const { data: policy } = await admin
    .from('cancellation_policies')
    .select('*')
    .eq('facility_id', booking.facility_id)
    .single();

  // Calculate cancellation fee — 予約日までの残日数は JST の暦日差で算出する。
  // 以前は new Date('YYYY-MM-DD')(UTC0時) と Date.now()(UTC実時刻) の差を ceil していたため、
  // JST 午前帯（UTC 前日）に実行すると残日数が +1 され、当日料が前日料になる等、料率が1段ズレた。
  // getTodayString()(JST) と booking_date を共に UTC 正午アンカーの純暦日に変換して差を取る。
  const daysUntil = Math.round(
    (dateToUtcNoon(booking.booking_date.slice(0, 10)) - dateToUtcNoon(getTodayString())) / (1000 * 60 * 60 * 24)
  );

  let feePercent = 0;
  if (policy) {
    if (daysUntil < 0) feePercent = policy.no_show_fee_percent ?? 100;
    else if (daysUntil === 0) feePercent = policy.same_day_fee_percent ?? 50;
    else if (daysUntil <= 1) feePercent = policy.one_day_fee_percent ?? 30;
    else if (daysUntil <= 3) feePercent = policy.three_day_fee_percent ?? 0;
  }

  if (feePercent === 0) {
    return NextResponse.json({ error: 'キャンセル料はかかりません', fee: 0 });
  }

  const feeAmount = Math.round((booking.total_price ?? 0) * feePercent / 100);
  if (feeAmount < 50) {
    return NextResponse.json({ error: 'キャンセル料が最小金額（50円）を下回ります', fee: feeAmount });
  }

  // Get facility info
  const { data: facility } = await admin
    .from('facility_profiles')
    .select('name, slug, stripe_enabled')
    .eq('id', booking.facility_id)
    .single();

  if (!facility?.stripe_enabled) {
    return NextResponse.json({ error: 'この施設はオンライン決済に対応していません' }, { status: 400 });
  }

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: {
          name: `${String(facility.name).slice(0, 100)} キャンセル料（${feePercent}%）`,
          description: `予約ID: ${booking.id.slice(0, 8)} / ${String(booking.menu_name ?? '施術').slice(0, 100)}`,
        },
        unit_amount: feeAmount,
      },
      quantity: 1,
    }],
    success_url: `${SITE_URL}/mypage/bookings/${booking.id}?cancel_fee=paid`,
    cancel_url: `${SITE_URL}/mypage/bookings/${booking.id}?cancel_fee=cancelled`,
    metadata: {
      booking_id: booking.id,
      facility_id: booking.facility_id,
      user_id: user.id,
      payment_type: 'cancel_fee',
    },
  });

  // Record in stripe_sessions — must succeed before returning the URL.
  // If this fails, we have an orphaned Stripe session with no DB record;
  // the webhook would find no matching row and silently drop the payment.
  const { error: sessionInsertErr } = await admin.from('stripe_sessions').insert({
    booking_id: booking.id,
    facility_id: booking.facility_id,
    user_id: user.id,
    stripe_session_id: session.id,
    amount: feeAmount,
    currency: 'jpy',
    status: 'pending',
    payment_type: 'cancel_fee',
  });
  if (sessionInsertErr) {
    console.error('[cancel-fee] stripe_sessions insert failed — expiring Stripe session', { sessionId: session.id, err: sessionInsertErr });
    // Best-effort: expire the Stripe session so the user cannot pay an untracked charge.
    await getStripe().checkout.sessions.expire(session.id).catch(() => {});
    return NextResponse.json({ error: '決済セッションの作成に失敗しました。しばらく後に再度お試しください。' }, { status: 500 });
  }

  return NextResponse.json({
    url: session.url,
    session_id: session.id,
    fee_amount: feeAmount,
    fee_percent: feePercent,
  });
  } catch (e) {
    console.error('[cancel-fee] error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
