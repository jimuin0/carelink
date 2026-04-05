/**
 * Stripe Webhook（v8.5）
 * POST /api/payment/webhook
 * 支払い完了時にbookingsのpayment_statusを更新
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.booking_id;
    const amountTotal = session.amount_total;

    if (bookingId) {
      await supabase
        .from('bookings')
        .update({
          payment_status: 'paid',
          stripe_payment_intent_id: session.payment_intent as string,
          paid_amount: amountTotal || 0,
        })
        .eq('id', bookingId);
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = charge.payment_intent as string;

    if (paymentIntentId) {
      const isFullRefund = charge.amount_refunded >= charge.amount;
      await supabase
        .from('bookings')
        .update({
          payment_status: isFullRefund ? 'refunded' : 'partial_refund',
        })
        .eq('stripe_payment_intent_id', paymentIntentId);
    }
  }

  return NextResponse.json({ received: true });
}
