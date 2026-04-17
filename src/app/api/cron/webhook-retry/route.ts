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

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    await supabase
      .from('webhook_retry_queue')
      .update({ status: 'processing' })
      .in('id', jobIds);

    let success = 0;
    let failed = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const job of jobs) {
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

        // 成功
        await supabase
          .from('webhook_retry_queue')
          .update({
            status: 'success',
            attempt_count: job.attempt_count + 1,
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        success++;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        await scheduleRetry(job.id, job.attempt_count + 1, errorMsg);
        failed++;
      }
    }

    await logCronRun('webhook-retry', 'success', startedAt, {
      processed: success,
      skipped: failed,
      meta: { total: jobs.length },
    });

    return NextResponse.json({ processed: success, failed });
  } catch (e) {
    await logCronRun('webhook-retry', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
