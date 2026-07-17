/**
 * Stripe Webhook（v8.5）
 * POST /api/payment/webhook
 * 支払い完了時にbookingsのpayment_statusを更新
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { alertCaughtError } from '@/lib/alert';
import { errorMessage } from '@/lib/err';

export const dynamic = 'force-dynamic';

/**
 * 失敗時の冪等行ロールバック（恒久根治）。
 *
 * stripe_events 行は処理前にコミットしているため、更新失敗で 500 を返すだけだと
 * Stripe リトライが冪等ガード（INSERT 23505）に阻まれ re-process されず、
 * 課金済みなのにエンタイトルメント／予約が永久未反映になる（発症後では検知不能）。
 * 失敗時は冪等行を削除してリトライで確実に再処理させ、Slack で即時通知する。
 * 各更新は upsert / update by id でべき等のため、再処理しても二重反映しない（副作用なし）。
 */
async function rollbackIdempotencyAndAlert(
  supabase: SupabaseClient,
  eventId: string,
  tag: string,
  error: unknown,
): Promise<void> {
  const { error: delErr } = await supabase.from('stripe_events').delete().eq('id', eventId);
  if (delErr) {
    // 削除も失敗＝冪等行が残りリトライがスキップされる。手動照合が必要なため error ログで残す。
    console.error('[payment/webhook] idempotency rollback failed — Stripe retry will be skipped; manual reconcile needed', { eventId, delErr });
  }
  alertCaughtError(tag, error, '/api/payment/webhook');
}

export async function POST(request: Request) {
  // 署名検証を設定確認より先に行う（/api/stripe/webhook と整合・よりセキュア）。
  // 未署名リクエストには設定状態(503)を晒さず、まず 400 で拒否する。
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const stripe = new Stripe(stripeKey);

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

      // 有料オプション（施設向け月額サブスク）の購入完了 → エンタイトルメント自動有効化。
      // /api/options/checkout が metadata に facility_id + option_key を載せる。
      const optionKey = session.metadata?.option_key;
      const facilityId = session.metadata?.facility_id;
      if (optionKey && facilityId) {
        const newSubId = (session.subscription as string) ?? null;

        // 監査D1: 二重決済完了（利用者が2タブ等で両方の Checkout を完了）時、下の upsert は
        // onConflict('facility_id,option_key') で後勝ちするため、上書きされる旧 subscription が
        // どの entitlement 行からも参照されない孤児となり、毎月課金され続ける。upsert 前に既存
        // active 行の stripe_subscription_id を確認し、新 sub と異なる非null の旧 sub があれば
        // Stripe 側で cancel して孤児化＝二重課金の継続を根絶する。
        // 通常フロー（初回購入で既存 active 無し／同一イベント再処理で sub 同一）では cancel しない。
        if (newSubId) {
          const { data: existingEnt } = await supabase
            .from('facility_entitlements')
            .select('stripe_subscription_id')
            .eq('facility_id', facilityId)
            .eq('option_key', optionKey)
            .eq('status', 'active')
            .maybeSingle();
          const oldSubId = existingEnt?.stripe_subscription_id;
          if (oldSubId && oldSubId !== newSubId) {
            try {
              await stripe.subscriptions.cancel(oldSubId);
              console.warn('[payment/webhook] 孤児化防止: 旧サブスクを cancel', { facilityId, optionKey, oldSubId, newSubId });
            } catch (cancelErr) {
              // 旧 sub が既に cancel 済み/不存在の場合も含め cancel 失敗は致命ではないが、
              // 二重課金の継続に直結するため必ず可視化して手動確認へ回す。
              console.error('[payment/webhook] 旧サブスク cancel 失敗（二重課金の疑い・要手動確認）', {
                facilityId, optionKey, oldSubId, err: errorMessage(cancelErr),
              });
            }
          }
        }

        const { error } = await supabase
          .from('facility_entitlements')
          .upsert({
            facility_id: facilityId,
            option_key: optionKey,
            status: 'active',
            stripe_subscription_id: newSubId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'facility_id,option_key' });
        if (error) {
          console.error('[payment/webhook] CRITICAL: failed to activate entitlement', { facilityId, optionKey, eventId: event.id, error });
          // 冪等行を削除して Stripe リトライで再処理可能化＋Slack 通知（恒久根治）。
          await rollbackIdempotencyAndAlert(supabase, event.id, 'payment-webhook-entitlement', error);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
        break;
      }

      if (bookingId) {
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({
            payment_status: 'paid',
            stripe_payment_intent_id: session.payment_intent as string,
            paid_amount: amountTotal || 0,
          })
          .eq('id', bookingId)
          .select('id');
        if (error) {
          console.error('[payment/webhook] CRITICAL: failed to mark booking paid', { bookingId, eventId: event.id, error });
          // 冪等行を削除して Stripe リトライで再処理可能化＋Slack 通知（恒久根治）。
          await rollbackIdempotencyAndAlert(supabase, event.id, 'payment-webhook-booking-paid', error);
          return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
        }
        if (!updated || updated.length === 0) {
          // Supabase の .update() は該当0行でも error=null を返す。id 指定なのに0行＝
          // 該当予約が存在しない異常（正常系では発生し得ない）。entitlement 分岐と同水準の防御。
          console.error('[payment/webhook] CRITICAL: booking not found for payment update (0 rows)', { bookingId, eventId: event.id });
          await rollbackIdempotencyAndAlert(
            supabase,
            event.id,
            'payment-webhook-booking-paid-notfound',
            new Error(`booking not found: ${bookingId}`),
          );
          return NextResponse.json({ error: 'Booking not found' }, { status: 500 });
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (bookingId) {
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({
            payment_status: 'failed',
            stripe_payment_intent_id: pi.id,
          })
          .eq('id', bookingId)
          .select('id');
        if (error) {
          console.error('[payment/webhook] failed to mark payment_failed', { bookingId, eventId: event.id, error });
        } else if (!updated || updated.length === 0) {
          console.error('[payment/webhook] booking not found for payment_failed update (0 rows)', { bookingId, eventId: event.id });
          alertCaughtError(
            'payment-webhook-payment-failed-notfound',
            new Error(`booking not found: ${bookingId}`),
            '/api/payment/webhook',
          );
        }
      } else {
        // metadataにbooking_idがない場合はpayment_intent_idで検索
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({ payment_status: 'failed' })
          .eq('stripe_payment_intent_id', pi.id)
          .select('id');
        if (error) {
          console.error('[payment/webhook] failed to mark payment_failed by pi_id', { piId: pi.id, error });
        } else if (!updated || updated.length === 0) {
          // payment_intent は booking 以外のチャージ（サブスク・広告等）でも発火するため、
          // 該当予約が無いのは正常系としてあり得る。500 にはしない。
          console.warn('[payment/webhook] no booking matched payment_failed by pi_id (0 rows, may be non-booking charge)', { eventType: event.type, piId: pi.id });
        }
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = charge.payment_intent as string;

      if (paymentIntentId) {
        const isFullRefund = charge.amount_refunded >= charge.amount;
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({
            payment_status: isFullRefund ? 'refunded' : 'partial_refund',
          })
          .eq('stripe_payment_intent_id', paymentIntentId)
          .select('id');
        if (error) {
          console.error('[payment/webhook] failed to update refund status', { paymentIntentId, error });
        } else if (!updated || updated.length === 0) {
          // charge.refunded は booking 以外のチャージ（サブスク・広告等）でも発火するため、
          // 該当予約が無いのは正常系としてあり得る。500 にはしない。
          console.warn('[payment/webhook] no booking matched refund (0 rows, may be non-booking charge)', { eventType: event.type, paymentIntentId });
        }
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = dispute.payment_intent as string;
      if (paymentIntentId) {
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({ payment_status: 'disputed' })
          .eq('stripe_payment_intent_id', paymentIntentId)
          .select('id');
        if (error) {
          console.error('[payment/webhook] failed to mark disputed', { paymentIntentId, error });
        } else if (!updated || updated.length === 0) {
          // charge.dispute.* は booking 以外のチャージでも発火するため、該当予約が無いのは正常系としてあり得る。
          console.warn('[payment/webhook] no booking matched dispute.created (0 rows, may be non-booking charge)', { eventType: event.type, paymentIntentId });
        }
      }
      break;
    }

    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = dispute.payment_intent as string;
      if (paymentIntentId) {
        const status = dispute.status === 'won' ? 'paid' : 'dispute_lost';
        const { data: updated, error } = await supabase
          .from('bookings')
          .update({ payment_status: status })
          .eq('stripe_payment_intent_id', paymentIntentId)
          .select('id');
        if (error) {
          console.error('[payment/webhook] failed to close dispute', { paymentIntentId, status, error });
        } else if (!updated || updated.length === 0) {
          // charge.dispute.* は booking 以外のチャージでも発火するため、該当予約が無いのは正常系としてあり得る。
          console.warn('[payment/webhook] no booking matched dispute.closed (0 rows, may be non-booking charge)', { eventType: event.type, paymentIntentId, status });
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      // 有料オプションの解約 → エンタイトルメント自動無効化（有料機能の使い続け防止）
      const sub = event.data.object as Stripe.Subscription;
      const { error } = await supabase
        .from('facility_entitlements')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', sub.id);
      if (error) {
        console.error('[payment/webhook] CRITICAL: failed to cancel entitlement', { subscriptionId: sub.id, eventId: event.id, error });
        // 冪等行を削除して Stripe リトライで再処理可能化＋Slack 通知（恒久根治）。
        await rollbackIdempotencyAndAlert(supabase, event.id, 'payment-webhook-subscription-cancel', error);
        return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      // 上記以外の subscription イベントは現状処理不要。stripe_eventsテーブルで記録済み。
      break;

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
