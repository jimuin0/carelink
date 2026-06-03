/**
 * PAY.JP 予約事前決済（同期課金）— Stripe Checkout からの移行 Phase 1
 * POST /api/payment/payjp/charge
 *
 * フロー: クライアント(payjp.js / PAY.JP Checkout)がカードをトークン化 → 本APIに { bookingId, token } を送信
 *   → サーバが金額をDBから決定し charges.create で即時課金 → 成立で payment_status='paid' を同期確定。
 * 金額はクライアント値を信頼せず必ず bookings.total_price（なければ menu.price）から決定する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { getPayjp } from '@/lib/payjp';
import { alertError, alertWarning } from '@/lib/alert';

export const dynamic = 'force-dynamic';

// PAY.JP のカードトークンは 'tok_' + 英数字。長さ・文字種を検証して不正値を弾く。
const TOKEN_RE = /^tok_[A-Za-z0-9]+$/;

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const payjp = getPayjp();
  if (!payjp) {
    return NextResponse.json({ error: '決済機能が設定されていません' }, { status: 503 });
  }

  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'mutation')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { bookingId, token } = await request.json().catch(() => ({}));
    if (!bookingId || !UUID_REGEX.test(bookingId)) {
      return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    }
    if (typeof token !== 'string' || token.length > 100 || !TOKEN_RE.test(token)) {
      return NextResponse.json({ error: 'カードトークンが不正です' }, { status: 400 });
    }

    // 予約取得・所有権検証・金額をDBから決定
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select('id, user_id, total_price, facility_id, payment_status, menu:facility_menus(name, price)')
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

    const bookingRel = booking as unknown as { menu: { price: number; name: string } | { price: number; name: string }[] | null };
    const menu = Array.isArray(bookingRel.menu) ? bookingRel.menu[0] : bookingRel.menu;
    const serverAmount = booking.total_price ?? menu?.price ?? 0;
    if (!serverAmount || serverAmount <= 0) {
      return NextResponse.json({ error: '金額を決定できませんでした' }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    // 同期課金。トークンは単回使用のため二重課金は PAY.JP 側でも防がれる。
    let charge;
    try {
      charge = await payjp.charges.create({
        amount: serverAmount,
        currency: 'jpy',
        card: token,
        description: (menu?.name || '施術予約').slice(0, 200),
        capture: true,
        metadata: { booking_id: bookingId, user_id: user.id, payment_type: 'full' },
      });
    } catch (chargeErr) {
      // カード拒否・PAY.JP エラー。payment_status='failed' を記録し 402 を返す（金額は未確定のまま）。
      await admin.from('bookings').update({ payment_status: 'failed' }).eq('id', bookingId).eq('user_id', user.id);
      console.error('[payment/payjp/charge] charge failed', { bookingId, err: chargeErr instanceof Error ? chargeErr.message : String(chargeErr) });
      return NextResponse.json({ error: '決済に失敗しました。カード情報をご確認ください。' }, { status: 402 });
    }

    if (!charge.paid || !charge.captured) {
      await admin.from('bookings').update({ payment_status: 'failed' }).eq('id', bookingId).eq('user_id', user.id);
      return NextResponse.json({ error: '決済が完了しませんでした' }, { status: 402 });
    }

    // 課金成立 → payment_status='paid' を同期確定（金額・charge id を保存）。
    // この書き込みは冪等（同値 set）なので transient 失敗は数回リトライして整合確定を最優先する。
    let updateErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await admin
        .from('bookings')
        .update({ payment_status: 'paid', paid_amount: charge.amount, payjp_charge_id: charge.id })
        .eq('id', bookingId)
        .eq('user_id', user.id);
      updateErr = error;
      if (!error) break;
    }

    if (updateErr) {
      // 全リトライ失敗＝課金済みなのに予約を paid 化できない（金銭不整合）。
      // 顧客が確認できない予約に課金を保持しないため自動返金し整合を回復する（症状放置でなく真の予防）。
      try {
        await payjp.charges.refund(charge.id);
        alertWarning('payjp charge auto-refunded after booking update failure', {
          route: '/api/payment/payjp/charge',
          extra: { bookingId, chargeId: charge.id, updateErr: updateErr.message },
        });
        return NextResponse.json({ error: '決済処理中に問題が発生したため返金しました。お手数ですが再度お試しください。' }, { status: 500 });
      } catch (refundErr) {
        // 返金も失敗＝資金保持・要手動対応。ログ放置にせず 🔴 能動通知する。
        alertError('payjp charge succeeded but booking update AND refund failed — manual reconcile required', {
          route: '/api/payment/payjp/charge',
          extra: { bookingId, chargeId: charge.id, updateErr: updateErr.message, refundErr: refundErr instanceof Error ? refundErr.message : String(refundErr) },
        });
        return NextResponse.json({ error: '決済は完了しましたが予約の更新に失敗しました。サポートにお問い合わせください。', chargeId: charge.id }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, chargeId: charge.id, amount: charge.amount });
  } catch (e) {
    console.error('[payment/payjp/charge] Error:', e);
    return NextResponse.json({ error: '決済処理に失敗しました' }, { status: 500 });
  }
}
