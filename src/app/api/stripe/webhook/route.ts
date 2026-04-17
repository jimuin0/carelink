/**
 * Stripe Webhook ハンドラー
 * POST /api/stripe/webhook
 * Stripe署名検証 → イベント処理
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2025-04-30.basil',
});

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Idempotency: skip if already processed
  const { data: existing } = await admin
    .from('stripe_webhook_logs')
    .select('id, processed')
    .eq('event_id', event.id)
    .single();

  if (existing?.processed) {
    return NextResponse.json({ received: true, skipped: true });
  }

  // Log event
  await admin.from('stripe_webhook_logs').upsert({
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  try {
    await handleEvent(event, admin as unknown);
    await admin.from('stripe_webhook_logs').update({ processed: true }).eq('event_id', event.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    await admin.from('stripe_webhook_logs').update({ error: msg }).eq('event_id', event.id);
    console.error('Webhook handler error:', msg);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleEvent(event: Stripe.Event, admin: any) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata ?? {};

      // Update payment status
      await admin.from('stripe_sessions')
        .update({
          status: 'paid',
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_session_id', session.id);

      // Update booking status to confirmed if deposit was paid
      if (meta.booking_id && meta.payment_type === 'deposit') {
        await admin.from('bookings')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', meta.booking_id)
          .eq('status', 'pending');
      }

      // Activate featured slot if ad payment completed
      if (meta.slot_id) {
        await admin.from('featured_slots')
          .update({ is_active: true })
          .eq('id', meta.slot_id);
      }
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      await admin.from('stripe_sessions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('stripe_session_id', session.id);
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      if (charge.payment_intent && typeof charge.payment_intent === 'string') {
        await admin.from('stripe_sessions')
          .update({
            status: 'refunded',
            refund_amount: charge.amount_refunded,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_payment_intent_id', charge.payment_intent);
      }
      break;
    }

    default:
      // Unhandled event type — log but don't error
      break;
  }
}
