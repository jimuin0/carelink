/**
 * PAY.JP Webhook（POST /api/payjp/webhook・2026年11月13日・点検 B2-1）。
 *
 * 本人性は X-Payjp-Webhook-Token をダッシュボードの値（PAYJP_WEBHOOK_TOKEN）と定数時間で照合して確かめる
 * （PAY.JP の webhook に HMAC 署名は無い。https://docs.pay.jp/v1/webhook）。
 * 同じイベントは payjp_webhook_events で 1 回だけ処理する。反映に失敗したら processed_at を立てずに
 * serverError（Slack 通知）で 500 を返し、PAY.JP の再送（3 分おき・最大 3 回）で処理し直させる。
 */
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError } from '@/lib/with-route';
import { isPayjpEnabled } from '@/lib/integration-availability';
import { verifyPayjpWebhookToken } from '@/lib/payjp';
import { applyPayjpEvent, parsePayjpEvent } from '@/lib/featured-ads-payjp';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/payjp/webhook';

export async function POST(request: Request) {
  if (!isPayjpEnabled()) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  if (!verifyPayjpWebhookToken(request.headers.get('x-payjp-webhook-token'))) {
    return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401 });
  }
  const event = parsePayjpEvent(await request.json().catch(() => null));
  if (!event) return NextResponse.json({ error: 'Invalid event' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: seen, error: seenErr } = await admin.from('payjp_webhook_events')
    .select('processed_at').eq('event_id', event.id).maybeSingle();
  if (seenErr) return serverError('payjp-webhook-log-read', seenErr, ROUTE, 'Log read failed');
  if (seen?.processed_at) return NextResponse.json({ received: true, skipped: true });
  if (!seen) {
    // 並行配信で同時に入っても主キーで 1 行になる（重複は no-op）。反映自体も冪等。
    const { error: logErr } = await admin.from('payjp_webhook_events')
      .upsert({ event_id: event.id, event_type: event.type }, { onConflict: 'event_id', ignoreDuplicates: true });
    if (logErr) return serverError('payjp-webhook-log-insert', logErr, ROUTE, 'Log insert failed');
  }

  let outcome: Awaited<ReturnType<typeof applyPayjpEvent>>;
  try {
    outcome = await applyPayjpEvent(admin, event);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await admin.from('payjp_webhook_events').update({ error: message.slice(0, 1000) }).eq('event_id', event.id);
    return serverError('payjp-webhook-handler', err, ROUTE, 'Handler error');
  }

  const { error: doneErr } = await admin.from('payjp_webhook_events')
    .update({ processed_at: new Date().toISOString(), error: null }).eq('event_id', event.id);
  // 反映は済んでいる。記録だけ失敗した場合も再送で同じ結果になるので 500 で再送させてよい。
  if (doneErr) return serverError('payjp-webhook-log-done', doneErr, ROUTE, 'Log update failed');
  return NextResponse.json({ received: true, outcome });
}
