import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
/**
 * Stripe Checkout Session 作成（v8.5）
 * POST /api/payment/checkout
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SITE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
  }

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { bookingId, amount, facilityName, menuName } = await request.json();

    if (!bookingId || !amount || amount <= 0) {
      return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    }

    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: menuName || '施術予約',
            description: facilityName || 'CareLink予約',
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${SITE_URL}/mypage/bookings/${bookingId}?payment=success`,
      cancel_url: `${SITE_URL}/mypage/bookings/${bookingId}?payment=cancelled`,
      metadata: {
        booking_id: bookingId,
        user_id: user.id,
      },
      locale: 'ja',
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[payment/checkout] Error:', e);
    return NextResponse.json({ error: '決済セッションの作成に失敗しました' }, { status: 500 });
  }
}
