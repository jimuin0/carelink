/**
 * Stripe Webhook ハンドラー
 * POST /api/stripe/webhook
 * Stripe署名検証 → イベント処理
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';
import { alertCaughtError } from '@/lib/alert';

export const dynamic = 'force-dynamic';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
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
    await handleEvent(event, admin);
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
    // catch→500 は instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('stripe-webhook-handler', err, '/api/stripe/webhook');
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event, admin: ReturnType<typeof createServiceRoleClient>) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata ?? {};

      // Update payment status — throw on failure so outer handler returns 500 → Stripe retries
      const { data: sessionRows, error: sessionErr } = await admin.from('stripe_sessions')
        .update({
          status: 'paid',
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_session_id', session.id)
        .select('id');
      if (sessionErr) throw new Error(`stripe_sessions update failed: ${sessionErr.message}`);
      if (!sessionRows || sessionRows.length === 0) {
        // stripe_sessions に行を作るのは booking 系フロー（payment/checkout・stripe/checkout）のみ。
        // featured-ads（metadata=slot_id）と options/checkout（metadata=option_key）は行を作らないため、
        // それら由来のイベントでは 0 行が【正常系】。無条件 throw にすると広告枠・オプション決済が
        // 500→Stripe再送ループに陥り、featured_slots 有効化に永久に到達しない。
        // stripe_sessions に行を作る2フローは必ず metadata.payment_type を持つ（stripe/checkout は
        // booking 未指定の一般デポジットで booking_id を '' にするため、booking_id 単独判定だと
        // その経路の真の0行異常が warn止まりになる＝観測性の穴）。booking_id か payment_type の
        // いずれかがある場合のみ「作成済みのはずの行が無い」異常として throw
        //（500→Stripe リトライ・外側 catch が alertCaughtError で通知する）。
        if (meta.booking_id || meta.payment_type) {
          throw new Error(`stripe_sessions update matched 0 rows (session_id=${session.id})`);
        }
        console.warn('[stripe/webhook] stripe_sessions update matched 0 rows (non-booking checkout; booking_id/payment_type いずれも無し; continuing)', {
          sessionId: session.id,
          metadataKeys: Object.keys(meta),
        });
      }

      // Update booking status to confirmed if deposit was paid
      if (meta.booking_id && meta.payment_type === 'deposit') {
        const { data: confirmedRows, error: bookingErr } = await admin.from('bookings')
          .update({ status: 'confirmed', updated_at: new Date().toISOString() })
          .eq('id', meta.booking_id)
          .eq('status', 'pending')
          .select('id');
        if (bookingErr) throw new Error(`bookings deposit confirm failed: ${bookingErr.message}`);
        if (!confirmedRows || confirmedRows.length === 0) {
          // CAS（status='pending'）に一致する行が無い＝(1) 冪等リトライで既に confirmed 済 か
          // (2) 真の異常（booking 不存在・想定外ステータス）。現状を SELECT して切り分ける。
          const { data: current, error: currentErr } = await admin.from('bookings')
            .select('status')
            .eq('id', meta.booking_id)
            .maybeSingle();
          if (currentErr || current?.status !== 'confirmed') {
            // トリアージ精度のため「booking 不存在」と「切り分け SELECT 自体の失敗」を区別して通知する。
            const currentStatusLabel = currentErr
              ? `select_failed: ${currentErr.message}`
              : (current?.status ?? 'not_found');
            alertCaughtError(
              'stripe-webhook-deposit-confirm-0rows',
              new Error(`bookings deposit confirm matched 0 rows and booking is not confirmed (booking_id=${meta.booking_id}, current_status=${currentStatusLabel})`),
              '/api/stripe/webhook',
            );
            throw new Error(`bookings deposit confirm failed: 0 rows updated and booking not confirmed (booking_id=${meta.booking_id})`);
          }
          // 既に confirmed（冪等リトライで再到達）＝正常系として続行。
        }
      }

      // Mark cancel fee as paid on the booking
      if (meta.booking_id && meta.payment_type === 'cancel_fee') {
        const { data: cancelRows, error: cancelErr } = await admin.from('bookings')
          .update({ status: 'cancel_fee_paid', updated_at: new Date().toISOString() })
          .eq('id', meta.booking_id)
          .select('id');
        if (cancelErr) throw new Error(`bookings cancel_fee update failed: ${cancelErr.message}`);
        if (!cancelRows || cancelRows.length === 0) {
          // cancel_fee の update は .eq('id', ...)（PK）のみで CAS が無いため、冪等リトライでも
          // 行が存在する限り必ず 1 行 match する。0 行になり得るのは【booking 不存在】のみ
          //（cancel_fee_paid への遷移元集合は booking-status.ts に定義が無く CAS は付与しない）。
          alertCaughtError(
            'stripe-webhook-cancel-fee-0rows',
            new Error(`bookings cancel_fee update matched 0 rows — booking not found (booking_id=${meta.booking_id})`),
            '/api/stripe/webhook',
          );
          throw new Error(`bookings cancel_fee update failed: 0 rows updated (booking_id=${meta.booking_id})`);
        }
      }

      // Activate featured slot if ad payment completed
      if (meta.slot_id) {
        const { data: slotRows, error: slotErr } = await admin.from('featured_slots')
          .update({ is_active: true })
          .eq('id', meta.slot_id)
          .select('id');
        if (slotErr) {
          console.error('[stripe/webhook] featured_slot activate failed:', slotErr);
        } else if (!slotRows || slotRows.length === 0) {
          console.error('[stripe/webhook] featured_slot activate matched 0 rows', { slotId: meta.slot_id });
        }
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
        // error を捕捉して throw する。捕捉しないと CHECK 制約違反等が無音で no-op になり、
        // 返金が DB に記録されないまま processed=true になる（敵対監査で確定した無音欠落の根治）。
        const { error: refundErr } = await admin.from('stripe_sessions')
          .update({
            status: isFullRefund ? 'refunded' : 'partial_refund',
            refund_amount: charge.amount_refunded,
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_payment_intent_id', charge.payment_intent);
        if (refundErr) throw new Error(`stripe_sessions refund update failed: ${refundErr.message}`);
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
      if (paymentIntentId) {
        const { error: sessionErr } = await admin.from('stripe_sessions')
          .update({ status: 'disputed', updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (sessionErr) throw new Error(`stripe_sessions dispute update failed: ${sessionErr.message}`);
        const { error: bookingErr } = await admin.from('bookings')
          .update({ payment_status: 'disputed' })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (bookingErr) throw new Error(`bookings dispute update failed: ${bookingErr.message}`);
      }
      break;
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
      if (paymentIntentId) {
        const status = dispute.status === 'won' ? 'paid' : 'dispute_lost';
        const { error: sessionErr } = await admin.from('stripe_sessions')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (sessionErr) throw new Error(`stripe_sessions dispute close update failed: ${sessionErr.message}`);
        const { error: bookingErr } = await admin.from('bookings')
          .update({ payment_status: status })
          .eq('stripe_payment_intent_id', paymentIntentId);
        if (bookingErr) throw new Error(`bookings dispute close update failed: ${bookingErr.message}`);
      }
      break;
    }

    default:
      // Unhandled event type — log but don't error
      break;
  }
}
