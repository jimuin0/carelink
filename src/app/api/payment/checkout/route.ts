import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
/**
 * Stripe Checkout Session 作成（v8.5）
 * POST /api/payment/checkout
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SITE_URL, UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { alertCaughtError } from '@/lib/alert';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
  }

  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { bookingId } = await request.json().catch(() => ({}));

    if (!bookingId || !UUID_REGEX.test(bookingId)) {
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
    const bookingRel = booking as unknown as { menu: { price: number; name: string } | { price: number; name: string }[] | null; facility: { name: string } | { name: string }[] | null };
    const menu = Array.isArray(bookingRel.menu) ? bookingRel.menu[0] : bookingRel.menu;
    const facility = Array.isArray(bookingRel.facility) ? bookingRel.facility[0] : bookingRel.facility;
    const serverAmount = booking.total_price ?? menu?.price ?? 0;

    if (!serverAmount || serverAmount <= 0) {
      return NextResponse.json({ error: '金額を決定できませんでした' }, { status: 400 });
    }

    // Stripe product name は最大 5000 文字だが、UI 表示を考慮して 200 文字に制限
    const menuName = (menu?.name || '施術予約').slice(0, 200);
    const facilityName = (facility?.name || 'CareLink予約').slice(0, 200);

    const stripe = new Stripe(stripeKey);
    const admin = createServiceRoleClient();

    // 同一予約に未完了(pending)の決済セッションが残っていると、ユーザーが複数のセッションを
    // 同時に完了でき二重課金になり得る。新規作成前に既存 pending を Stripe 側で失効させ、
    // DB も expired に更新して「有効な pending は最新1件のみ」へ収束させる（放棄→再開フローは
    // 旧セッションを失効させて新規発行するため壊れない）。完全な競合防止は別途 DB の
    // 部分 UNIQUE インデックス（booking_id WHERE status='pending'）で担保する。
    const { data: stalePending } = await admin
      .from('stripe_sessions')
      .select('stripe_session_id')
      .eq('booking_id', bookingId)
      .eq('status', 'pending');
    if (stalePending && stalePending.length > 0) {
      for (const s of stalePending) {
        await stripe.checkout.sessions.expire(s.stripe_session_id).catch(() => {});
      }
      await admin
        .from('stripe_sessions')
        .update({ status: 'expired' })
        .eq('booking_id', bookingId)
        .eq('status', 'pending');
    }

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
        payment_type: 'full',
      },
      locale: 'ja',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    // Record session in DB before returning URL.
    // If this fails, expire the Stripe session to prevent orphaned charges.
    const { error: sessionInsertErr } = await admin.from('stripe_sessions').insert({
      booking_id: bookingId,
      facility_id: booking.facility_id,
      user_id: user.id,
      stripe_session_id: session.id,
      amount: serverAmount,
      currency: 'jpy',
      status: 'pending',
      payment_type: 'full',
      expires_at: new Date((Math.floor(Date.now() / 1000) + 30 * 60) * 1000).toISOString(),
    });
    if (sessionInsertErr) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      console.error('[payment/checkout] stripe_sessions insert failed — Stripe session expired', { sessionId: session.id, err: sessionInsertErr });
      return NextResponse.json({ error: '決済セッションの作成に失敗しました。しばらく後に再度お試しください。' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[payment/checkout] Error:', e);
    // catch して 500 を返すと onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('payment-checkout', e, '/api/payment/checkout');
    return NextResponse.json({ error: '決済セッションの作成に失敗しました' }, { status: 500 });
  }
}
