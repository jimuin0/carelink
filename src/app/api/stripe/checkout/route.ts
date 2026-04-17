/**
 * Stripe Checkout セッション作成
 * POST /api/stripe/checkout
 * Body: { booking_id, facility_id, amount, payment_type }
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2025-04-30.basil',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carelink-jp.com';

export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { booking_id, facility_id, amount, payment_type = 'deposit' } = body as {
    booking_id?: string; facility_id: string; amount: number; payment_type?: string;
  };

  if (!facility_id || !amount || amount < 50) {
    return NextResponse.json({ error: 'facility_id と amount（最小50円）が必要です' }, { status: 400 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 施設情報取得
  const { data: facility } = await admin
    .from('facility_profiles')
    .select('id, name, slug, stripe_enabled, stripe_account_id')
    .eq('id', facility_id)
    .single();

  if (!facility) return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
  if (!facility.stripe_enabled) return NextResponse.json({ error: 'この施設はオンライン決済に対応していません' }, { status: 400 });

  // Get user email
  const { data: authUser } = await admin.auth.admin.getUserById(user.id);
  const email = authUser?.user?.email;

  // Platform fee: 5% if Connect account
  const paymentIntentData = facility.stripe_account_id ? {
    application_fee_amount: Math.round(amount * 0.05),
    transfer_data: { destination: facility.stripe_account_id },
  } : undefined;

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: {
          name: `${facility.name} ${payment_type === 'deposit' ? 'デポジット' : '予約料金'}`,
          description: booking_id ? `予約ID: ${booking_id.slice(0, 8)}` : undefined,
        },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    success_url: `${SITE_URL}/mypage/bookings${booking_id ? `/${booking_id}` : ''}?payment=success`,
    cancel_url: `${SITE_URL}/facility/${facility.slug}/booking?payment=cancelled`,
    customer_email: email ?? undefined,
    metadata: {
      booking_id: booking_id ?? '',
      facility_id,
      user_id: user.id,
      payment_type,
    },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
  });

  // Record session in DB
  await admin.from('stripe_sessions').insert({
    booking_id: booking_id ?? null,
    facility_id,
    user_id: user.id,
    stripe_session_id: session.id,
    amount,
    currency: 'jpy',
    status: 'pending',
    payment_type,
    expires_at: new Date((Math.floor(Date.now() / 1000) + 30 * 60) * 1000).toISOString(),
  });

  return NextResponse.json({ url: session.url, session_id: session.id });
}
