/**
 * Stripe Webhook（v8.5）
 * POST /api/payment/webhook
 * 支払い完了時にbookingsのpayment_statusを更新
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const stripe = new Stripe(stripeKey);
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 冪等性: 既処理イベントはスキップ
  const { data: inserted, error: idemErr } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })
    .select('id')
    .maybeSingle();

  if (idemErr) {
    // unique violation = 既処理（PostgREST: 23505）
    if ((idemErr as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[payment/webhook] idempotency insert error:', idemErr);
    return NextResponse.json({ error: 'idempotency error' }, { status: 500 });
  }
  if (!inserted) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.booking_id;
      const amountTotal = session.amount_total;

      if (bookingId) {
        const { error } = await supabase
          .from('bookings')
          .update({
            payment_status: 'paid',
            stripe_payment_intent_id: session.payment_intent as string,
            paid_amount: amountTotal || 0,
          })
          .eq('id', bookingId);
        if (error) {
          console.error('[payment/webhook] CRITICAL: failed to mark booking paid', { bookingId, eventId: event.id, error });
          // Return 500 so Stripe retries. The stripe_events row is already committed,
          // so the retry will hit the idempotency guard and skip re-processing.
          // Ops must manually reconcile if retries also fail.
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (bookingId) {
        const { error } = await supabase
          .from('bookings')
          .update({
            payment_status: 'failed',
            stripe_payment_intent_id: pi.id,
          })
          .eq('id', bookingId);
        if (error) console.error('[payment/webhook] failed to mark payment_failed', { bookingId, eventId: event.id, error });
      } else {
        // metadataにbooking_idがない場合はpayment_intent_idで検索
        const { error } = await supabase
          .from('bookings')
          .update({ payment_status: 'failed' })
          .eq('stripe_payment_intent_id', pi.id);
        if (error) console.error('[payment/webhook] failed to mark payment_failed by pi_id', { piId: pi.id, error });
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = charge.payment_intent as string;

      if (paymentIntentId) {
        const isFullRefund = charge.amount_refunded >= charge.amount;
        const { error } = await supabase
          .from('bookings')
          .update({
            payment_status: isFullRefund ? 'refunded' : 'partial_refund',
          })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (error) console.error('[payment/webhook] failed to update refund status', { paymentIntentId, error });
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = dispute.payment_intent as string;
      if (paymentIntentId) {
        const { error } = await supabase
          .from('bookings')
          .update({ payment_status: 'disputed' })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (error) console.error('[payment/webhook] failed to mark disputed', { paymentIntentId, error });
      }
      break;
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = dispute.payment_intent as string;
      if (paymentIntentId) {
        const status = dispute.status === 'won' ? 'paid' : 'dispute_lost';
        const { error } = await supabase
          .from('bookings')
          .update({ payment_status: status })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (error) console.error('[payment/webhook] failed to close dispute', { paymentIntentId, status, error });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      // subscription機能は将来実装予定。stripe_eventsテーブルで記録済み。
      break;

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
