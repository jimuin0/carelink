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

    const { bookingId } = await request.json();

    if (!bookingId) {
      return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    }

    // サーバー側で予約を取得し、所有権検証＋金額をDBから決定
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select('id, user_id, total_price, menu_id, facility_id, payment_status, facility:facility_profiles(name), menu:facility_menus(name, price)')
      .eq('id', bookingId)
      .single();

    if (bookingErr || !booking) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    if (booking.user_id !== user.id) {
      return NextResponse.json({ error: 'この予約にアクセスする権限がありません' }, { status: 403 });
    }

    if (booking.payment_status === 'paid') {
      return NextResponse.json({ error: 'この予約は既に支払い済みです' }, { status: 400 });
    }

    // 金額決定: bookings.total_price を優先、なければ menu.price にフォールバック
    const menu = Array.isArray((booking as any).menu) ? (booking as any).menu[0] : (booking as any).menu;
    const facility = Array.isArray((booking as any).facility) ? (booking as any).facility[0] : (booking as any).facility;
    const serverAmount = booking.total_price ?? menu?.price ?? 0;

    if (!serverAmount || serverAmount <= 0) {
      return NextResponse.json({ error: '金額を決定できませんでした' }, { status: 400 });
    }

    const menuName = menu?.name || '施術予約';
    const facilityName = facility?.name || 'CareLink予約';

    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: menuName,
            description: facilityName,
          },
          unit_amount: serverAmount,
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
