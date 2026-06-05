/**
 * Webhook リトライ Cron（v8.35）
 * GET /api/cron/webhook-retry
 * 15分ごとに実行: 失敗したWebhookを再送する
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { logCronRun } from '@/lib/cron-logger';
import { scheduleRetry } from '@/lib/webhook-queue';
import { sendLineText } from '@/lib/line';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertError } from '@/lib/alert';

export const dynamic = 'force-dynamic';

// processing に取り残された孤児ジョブを回収する経過時間しきい値。
// cron は15分間隔・関数最大実行は約5分なので、claimed_at が10分以上前の processing は確実にクラッシュ孤児。
const STALE_PROCESSING_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();

  try {
    // ── reaper: 前回実行のクラッシュ等で processing に取り残された孤児を回収（永久喪失/重複の両防止）──
    // delivered_at を「配信済み（不可逆）」の唯一の権威とし、それで再送可否を分岐する。
    const nowIso = new Date().toISOString();
    // (a) 配信済みなのに success マーク前に落ちた行 → 再送せず success 確定（重複配信を防ぐ）
    const { error: reapDeliveredErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'success', processed_at: nowIso })
      .eq('status', 'processing')
      .not('delivered_at', 'is', null);
    if (reapDeliveredErr) {
      console.error('[webhook-retry] reaper(delivered) failed', { err: reapDeliveredErr.message });
    }
    // (b) 未配信のまま取り残された行（claimed_at が古い）→ pending に戻して再送対象化（永久喪失を防ぐ）
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const { error: reapStaleErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'pending', claimed_at: null })
      .eq('status', 'processing')
      .is('delivered_at', null)
      .lt('claimed_at', staleCutoff);
    if (reapStaleErr) {
      console.error('[webhook-retry] reaper(stale) failed', { err: reapStaleErr.message });
    }

    // pending かつ scheduled_at が現在時刻以前のジョブを取得
    const { data: jobs } = await supabase
      .from('webhook_retry_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (!jobs || jobs.length === 0) {
      await logCronRun('webhook-retry', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0 });
    }

    // ── アトミック claim: status='pending' ガード付き UPDATE ... RETURNING で「実際に掴めた行」だけ処理する。
    // 並行実行（重複スケジュール・前回実行の延伸）で同じ pending を両者が拾っても、status が pending の行しか
    // 更新されないため、claimed に入るのは片方のみ。これで claim race 由来の二重配信を構造的に封鎖する。
    const jobIds = jobs.map((j) => j.id);
    const { data: claimed, error: claimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'processing', claimed_at: new Date().toISOString() })
      .eq('status', 'pending')
      .in('id', jobIds)
      .select();
    if (claimErr) {
      console.error('[webhook-retry] status claim failed — aborting to prevent duplicate delivery', { err: claimErr });
      await logCronRun('webhook-retry', 'error', startedAt, { error_msg: claimErr.message });
      return NextResponse.json({ error: 'claim failed' }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      // 並行実行が先に全件 claim した。重複処理しない。
      await logCronRun('webhook-retry', 'skipped', startedAt);
      return NextResponse.json({ processed: 0 });
    }

    let success = 0;
    let failed = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const job of claimed) {
      // 「外部送信(不可逆)」と「DB状態更新」を厳密に分離する（round5 #通知-1 / scale監査 #5）。
      // 配信前の失敗のみ再送し、配信成功後は何があっても再送しない（重複配信を防ぐ）。
      try {
        if (job.webhook_type === 'line_push') {
          await sendLineText(job.target_id, job.payload.message as string);
        } else if (job.webhook_type === 'email' && resend) {
          const p = job.payload as { to: string; subject: string; html: string; from?: string };
          await resend.emails.send({
            from: p.from || process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
            to: p.to,
            subject: p.subject,
            html: p.html,
          });
        }
      } catch (e) {
        // 配信前の失敗 → 再送対象。
        await scheduleRetry(job.id, job.attempt_count + 1, e instanceof Error ? e.message : String(e));
        failed++;
        continue;
      }

      // ここに到達＝配信成功（不可逆）。以降の DB 失敗（{error}返却・throw のいずれも）は「再送」してはならない。
      // try で包み、配信後の DB 例外でも cron を落とさず再送もしない（reaper が delivered_at 基準で確定）。
      try {
        // 1) 配信済みを即時 stamp。これが冪等性の境界。processing で残っても reaper(a) が再送せず success 化する。
        const { error: deliverErr } = await supabase
          .from('webhook_retry_queue')
          .update({ delivered_at: new Date().toISOString() })
          .eq('id', job.id);
        if (deliverErr) {
          console.error('[webhook-retry] delivered but delivered_at stamp failed (reaper(stale) may resend after cutoff)', { id: job.id, err: deliverErr.message });
        }
        // 2) 完了マーク。失敗しても配信済みは覆さない（reaper(a) が delivered_at 基準で success 確定）。
        const { error: markErr } = await supabase
          .from('webhook_retry_queue')
          .update({ status: 'success', attempt_count: job.attempt_count + 1, processed_at: new Date().toISOString() })
          .eq('id', job.id);
        if (markErr) {
          console.error('[webhook-retry] delivered but success-mark failed (will NOT resend; reaper finalizes)', { id: job.id, err: markErr.message });
        }
      } catch (dbErr) {
        console.error('[webhook-retry] delivered but post-send DB write threw (will NOT resend)', { id: job.id, err: dbErr instanceof Error ? dbErr.message : String(dbErr) });
      }
      success++;
    }

    await logCronRun('webhook-retry', 'success', startedAt, {
      processed: success,
      skipped: failed,
      meta: { total: claimed.length },
    });

    return NextResponse.json({ processed: success, skipped: failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // cron 本体の致命例外は能動通知（受動ダッシュボード待ちにしない・scale監査 #5）
    alertError('webhook-retry cron failed', { route: '/api/cron/webhook-retry', extra: { error: msg } });
    await logCronRun('webhook-retry', 'error', startedAt, { error_msg: msg });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
