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
import { errorMessage } from '@/lib/err';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();

  try {
    // 前 run が claim（status='processing'）後にクラッシュすると、その行は processing のまま
    // 取り残される。本 cron は status='pending' しか拾わないため、孤児は永久に再送されない。
    // run の所要時間（数秒）を大きく超えて processing のままの行（scheduled_at が1時間以上前）は
    // 孤児とみなし pending に戻して再回収する（best-effort・失敗しても本処理は継続）。
    // 閾値1hは cron 間隔15分・run所要数秒を十分上回り、正常処理中の行を誤って戻さない。
    const staleProcessingBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: reclaimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lt('scheduled_at', staleProcessingBefore);
    if (reclaimErr) {
      console.error('[webhook-retry] stale processing reclaim failed (continuing)', { err: reclaimErr });
    }

    // pending かつ scheduled_at が現在時刻以前のジョブを取得
    const { data: jobs, error: jobsError } = await supabase
      .from('webhook_retry_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50);

    // DB エラーを握り潰すと「0 件＝skipped 成功」に化け、その run が無音でスキップされ Slack 通報も
    // されない。error を error ログ＋500 で可視化する（発症前検知）。
    if (jobsError) {
      await logCronRun('webhook-retry', 'error', startedAt, { error_msg: errorMessage(jobsError) });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      await logCronRun('webhook-retry', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0 });
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
      try {
        if (job.webhook_type === 'line_push') {
          // sendLineText はリトライ上限到達時に throw せず false を返す。
          // 戻り値を無視すると配信失敗でも下で status='success' に更新され、
          // 通知が永久に消失する（サイレントデータロス）。false を明示的に throw し
          // catch → scheduleRetry へ回して再送キューに戻す（発症前予防）。
          const ok = await sendLineText(job.target_id, job.payload.message as string);
          if (!ok) throw new Error('line_push failed after all retries');
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

    return NextResponse.json({ processed: success, skipped: failed });
  } catch (e) {
    await logCronRun('webhook-retry', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
