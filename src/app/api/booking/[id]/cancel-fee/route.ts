/**
 * キャンセル料 Stripe Checkout
 * POST /api/booking/[id]/cancel-fee
 * — キャンセルポリシーに基づいてキャンセル料を請求
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2025-04-30.basil',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carelink-jp.com';

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

  // Calculate cancellation fee
  const daysUntil = Math.ceil(
    (new Date(booking.booking_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
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

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: {
          name: `${facility.name} キャンセル料（${feePercent}%）`,
          description: `予約ID: ${booking.id.slice(0, 8)} / ${booking.menu_name ?? '施術'}`,
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

  // Record in stripe_sessions
  await admin.from('stripe_sessions').insert({
    booking_id: booking.id,
    facility_id: booking.facility_id,
    user_id: user.id,
    stripe_session_id: session.id,
    amount: feeAmount,
    currency: 'jpy',
    status: 'pending',
    payment_type: 'cancel_fee',
  });

  return NextResponse.json({
    url: session.url,
    session_id: session.id,
    fee_amount: feeAmount,
    fee_percent: feePercent,
  });
}
