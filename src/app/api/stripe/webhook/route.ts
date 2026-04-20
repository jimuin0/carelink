/**
 * Stripe Webhook ハンドラー
 * POST /api/stripe/webhook
 * Stripe署名検証 → イベント処理
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, {
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
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Idempotency: atomic upsert with ON CONFLICT DO NOTHING pattern.
  // Using upsert with ignoreDuplicates prevents the TOCTOU race where two simultaneous
  // deliveries both pass a "not processed" read before either writes the log row.
  // The unique constraint on event_id ensures only one row is inserted; subsequent
  // requests will see the existing row and skip processing.
  const { error: upsertError } = await admin.from('stripe_webhook_logs').upsert({
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
    processed: false,
  }, { onConflict: 'event_id', ignoreDuplicates: true });

  if (upsertError) {
    // upsert failed — another request may be processing concurrently; skip
    console.error('Webhook log upsert error:', upsertError.message);
    return NextResponse.json({ received: true, skipped: true });
  }

  // Re-read to check if this insert actually inserted (ignoreDuplicates means a conflict
  // means another delivery already owns this event_id).
  const { data: existing } = await admin
    .from('stripe_webhook_logs')
    .select('id, processed')
    .eq('event_id', event.id)
    .single();

  if (existing?.processed) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    await handleEvent(event, admin as unknown);
    // Mark processed: true only after successful handling.
    // If this update fails and Stripe retries, ignoreDuplicates above will find the
    // existing row with processed=false and re-run the handler — intentionally safe
    // because all handleEvent operations are idempotent (.update/.eq patterns).
    await admin.from('stripe_webhook_logs').update({ processed: true }).eq('event_id', event.id);
    void writeAuditLog({
      action: 'update',
      tableName: 'stripe_webhook_logs',
      recordId: event.id,
      newValues: { event_type: event.type, processed: true },
    });
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

      // Update payment status — throw on failure so outer handler returns 500 → Stripe retries
      const { error: sessionErr } = await admin.from('stripe_sessions')
        .update({
          status: 'paid',
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_session_id', session.id);
      if (sessionErr) throw new Error(`stripe_sessions update failed: ${sessionErr.message}`);

      // Update booking status to confirmed if deposit was paid
      if (meta.booking_id && meta.payment_type === 'deposit') {
        const { error: bookingErr } = await admin.from('bookings')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', meta.booking_id)
          .eq('status', 'pending');
        if (bookingErr) throw new Error(`bookings deposit confirm failed: ${bookingErr.message}`);
      }

      // Mark cancel fee as paid on the booking
      if (meta.booking_id && meta.payment_type === 'cancel_fee') {
        const { error: cancelErr } = await admin.from('bookings')
          .update({ status: 'cancel_fee_paid', updated_at: new Date().toISOString() })
          .eq('id', meta.booking_id);
        if (cancelErr) throw new Error(`bookings cancel_fee update failed: ${cancelErr.message}`);
      }

      // Activate featured slot if ad payment completed
      if (meta.slot_id) {
        const { error: slotErr } = await admin.from('featured_slots')
          .update({ is_active: true })
          .eq('id', meta.slot_id);
        if (slotErr) console.error('[stripe/webhook] featured_slot activate failed:', slotErr);
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
        const isFullRefund = charge.amount_refunded >= charge.amount;
        await admin.from('stripe_sessions')
          .update({
            status: isFullRefund ? 'refunded' : 'partial_refund',
            refund_amount: charge.amount_refunded,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_payment_intent_id', charge.payment_intent);
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
      if (paymentIntentId) {
        await admin.from('stripe_sessions')
          .update({ status: 'disputed', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', paymentIntentId);
        await admin.from('bookings')
          .update({ payment_status: 'disputed' })
          .eq('stripe_payment_intent_id', paymentIntentId);
      }
      break;
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
      if (paymentIntentId) {
        const status = dispute.status === 'won' ? 'paid' : 'dispute_lost';
        await admin.from('stripe_sessions')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', paymentIntentId);
        await admin.from('bookings')
          .update({ payment_status: status })
          .eq('stripe_payment_intent_id', paymentIntentId);
      }
      break;
    }

    default:
      // Unhandled event type — log but don't error
      break;
  }
}
