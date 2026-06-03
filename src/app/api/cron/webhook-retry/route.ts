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

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();

  try {
    // pending かつ scheduled_at が現在時刻以前のジョブを取得
    const { data: jobs } = await supabase
      .from('webhook_retry_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (!jobs || jobs.length === 0) {
      await logCronRun('webhook-retry', 'skipped', startedAt);
      return NextResponse.json({ processed: 0 });
    }

    // processing に変更（二重実行防止）
    const jobIds = jobs.map((j) => j.id);
    const { error: claimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'processing' })
      .in('id', jobIds);
    if (claimErr) {
      console.error('[webhook-retry] status claim failed — aborting to prevent duplicate delivery', { err: claimErr });
      await logCronRun('webhook-retry', 'error', startedAt, { error_msg: claimErr.message });
      return NextResponse.json({ error: 'claim failed' }, { status: 500 });
    }

    let success = 0;
    let failed = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const job of jobs) {
      // 「外部送信(不可逆)」と「成功マークのDB書き込み」を分離する（round5 #通知-1）。
      // 送信成功後に success 更新が失敗しても再送(=重複配信)しない。delivered 確定後の例外は再送対象外。
      let delivered = false;
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
        delivered = true;

        // 成功マーク。ここでの失敗は配信済みを覆さない（再送せずログのみ。job は processing のまま残るが
        // 本cronは pending のみ拾うため二重配信は起きない）。supabase は throw せず {error} を返す経路。
        const { error: markErr } = await supabase
          .from('webhook_retry_queue')
          .update({
            status: 'success',
            attempt_count: job.attempt_count + 1,
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        if (markErr) {
          console.error('[webhook-retry] delivered but success-mark failed (will NOT resend)', { id: job.id, err: markErr.message });
        }
        success++;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        if (delivered) {
          // 配信後の例外（success更新の throw 等）は再送しない＝顧客への重複配信を防ぐ。
          console.error('[webhook-retry] delivered but post-send exception; NOT rescheduling', { id: job.id, err: errorMsg });
          success++;
          continue;
        }
        // 配信前の失敗のみ再送対象。
        await scheduleRetry(job.id, job.attempt_count + 1, errorMsg);
        failed++;
      }
    }

    await logCronRun('webhook-retry', 'success', startedAt, {
      processed: success,
      skipped: failed,
      meta: { total: jobs.length },
    });

    return NextResponse.json({ processed: success, skipped: failed });
  } catch (e) {
    await logCronRun('webhook-retry', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
