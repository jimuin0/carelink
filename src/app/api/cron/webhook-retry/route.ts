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
import { alertDeliveryFailures } from '@/lib/alert';
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
    // run の所要時間（数秒）を大きく超えて processing のままの行は孤児とみなし pending に
    // 戻して再回収する（best-effort・失敗しても本処理は継続）。
    //
    // 【2026年7月17日 二重配信バグの根治】旧実装は scheduled_at（＝配信予定時刻）を claim
    // 時刻の代用として使っていた。scheduled_at は「いつ送るべきか」であって「いつ claim した
    // か」ではないため、backlog（pending 行の滞留）時には scheduled_at が1時間以上前の行が
    // ちょうど claim され processing になった直後でも、この reclaim が「1時間以上 processing
    // のまま＝孤児」と誤認して pending に戻してしまう。cron は三重化（GitHub Actions + pg_cron
    // + Render）でほぼ同時に多重発火するため、戻された行が並行 run に即座に再 claim され
    // 【顧客への二重配信】が起こり得た。
    // 恒久対策＝claim 時刻そのもの（claimed_at）を基準にする。claimed_at IS NULL の行は
    // デプロイ過渡期（本カラム追加前に claim された行）にのみ存在し得るため、その場合だけ
    // 旧来の scheduled_at 判定にフォールバックする（新規行は claim 時に必ず claimed_at が
    // 入るためフォールバック経路には入らない＝挙動は新規行について厳密に改善のみ）。
    // 閾値1hは cron 間隔15分・run所要数秒を十分上回り、正常処理中の行を誤って戻さない。
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: reclaimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'pending', claimed_at: null })
      .eq('status', 'processing')
      .or(`claimed_at.lt.${staleBefore},and(claimed_at.is.null,scheduled_at.lt.${staleBefore})`);
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

    // processing に変更（二重実行防止）。
    // 【真のCAS・2026年7月16日】旧実装は `.in('id', jobIds)` のみで `.eq('status','pending')`
    // ガードが無く、SELECT→UPDATE が非原子だった。cron は三重化（GitHub Actions + pg_cron +
    // Render が同一 */15 発火）されており、並行 run が同じ pending 行を SELECT した後に両方が
    // 無条件 UPDATE で claim を「成功」させ、同一ジョブを二重配信し得た。
    // booking-reminder / review-request の claim と同方針の CAS：status='pending' の行だけを
    // processing へ更新し、`.select('id')` で【実際に claim できた行のみ】を後続処理対象にする
    // （update 結果の id リストが正）。他 run に先取りされた行は UPDATE の対象外＝返却されず、
    // この run では処理しない（二重送信の発症前予防）。
    const jobIds = jobs.map((j) => j.id);
    // claimed_at＝claim 成功時刻。stale reclaim（上記）はこの値を基準に「本当に processing の
    // まま孤児化したか」を判定する（scheduled_at 流用は二重配信の温床だったため廃止）。
    const { data: claimedRows, error: claimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'processing', claimed_at: new Date().toISOString() })
      .in('id', jobIds)
      .eq('status', 'pending')
      .select('id');
    if (claimErr) {
      console.error('[webhook-retry] status claim failed — aborting to prevent duplicate delivery', { err: claimErr });
      await logCronRun('webhook-retry', 'error', startedAt, { error_msg: claimErr.message });
      return NextResponse.json({ error: 'claim failed' }, { status: 500 });
    }
    // data が null（0行更新時のドライバ表現揺れ）も「1行も claim できなかった」として安全側に扱う。
    const claimedIds = new Set(((claimedRows ?? []) as { id: string }[]).map((r) => r.id));
    const claimedJobs = jobs.filter((j) => claimedIds.has(j.id));
    if (claimedJobs.length === 0) {
      // 全行を並行 run に先取りされた＝この run の仕事は無い（重複配信を作らず正常終了）。
      await logCronRun('webhook-retry', 'skipped', startedAt, { processed: 0, skipped: 0, meta: { total: jobs.length, claimed: 0 } });
      return NextResponse.json({ processed: 0, skipped: 0 });
    }

    let success = 0;
    let failed = 0;
    let deadLettered = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const job of claimedJobs) {
      try {
        if (job.webhook_type === 'line_push') {
          // sendLineText はリトライ上限到達時に throw せず false を返す。
          // 戻り値を無視すると配信失敗でも下で status='success' に更新され、
          // 通知が永久に消失する（サイレントデータロス）。false を明示的に throw し
          // catch → scheduleRetry へ回して再送キューに戻す（発症前予防）。
          const ok = await sendLineText(job.target_id, job.payload.message as string);
          if (!ok) throw new Error('line_push failed after all retries');
        } else if (job.webhook_type === 'email') {
          // RESEND_API_KEY 未設定（resend=null）でメールを送れない場合、旧実装は
          // この分岐に入らず下で status='success' に倒し、メールを一切送らずに配信済み扱い＝
          // サイレントデータロスだった。未設定は一過性事象（キー復旧で送れる）なので throw して
          // catch → scheduleRetry で再送キューに戻す（成功に倒さない）。
          if (!resend) throw new Error('email skipped: RESEND_API_KEY not configured');
          const p = job.payload as { to: string; subject: string; html: string; from?: string };
          await resend.emails.send({
            from: p.from || process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
            to: p.to,
            subject: p.subject,
            html: p.html,
          });
        } else {
          // 未知の webhook_type（例: line_multicast はハンドラ未実装）は、旧実装ではどの分岐にも
          // 入らず status='success' に倒れ「送信していないのに配信済み」＝サイレントデータロスだった。
          // ハンドラ不在は本来デプロイで解消される事象のため throw して scheduleRetry で保持し、
          // max_attempts 消化後に failed(dead-letter) へ落とす（無音で成功にしない）。
          throw new Error(`unsupported webhook_type: ${String(job.webhook_type)}`);
        }

        // 成功。配信（メール/LINE）は冪等でないため、ここで status='success' に確実に倒さないと
        // 行が processing のまま残り、上部の stale reclaim 経由で pending に戻され次 run で再送＝
        // 二重配信になる。旧実装はこの更新の error を握り潰していた（claim 路・失敗路は
        // error を扱うのにここだけ欠落）。一過性 DB エラーに備え限定リトライし、全敗時のみ CRITICAL で
        // 可視化する（配信済みのため scheduleRetry で再送に回してはならない）。
        let marked = false;
        for (let attempt = 0; attempt < 3 && !marked; attempt++) {
          const { error: successErr } = await supabase
            .from('webhook_retry_queue')
            .update({
              status: 'success',
              attempt_count: job.attempt_count + 1,
              processed_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          if (!successErr) {
            marked = true;
          } else {
            console.error('[webhook-retry] success mark failed (retrying)', { jobId: job.id, attempt: attempt + 1, err: errorMessage(successErr) });
          }
        }
        if (!marked) {
          // 配信は完了済み。success に倒せないと reclaim で再送され二重配信になるため CRITICAL で可視化。
          console.error('[webhook-retry] CRITICAL: delivered but could not mark success — possible duplicate delivery on reclaim', { jobId: job.id });
        }
        success++;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const outcome = await scheduleRetry(job.id, job.attempt_count + 1, errorMsg);
        // scheduleRetry の戻り値で dead-letter（再送上限到達・status='failed'・二度と自動
        // 再送されない）とrescheduled（次回試行を予約）を区別する。区別しないと
        // alertDeliveryFailures が dead-letter 分にも「翌runで再送」という嘘の文言を出す。
        if (outcome === 'dead-letter') deadLettered++;
        failed++;
      }
    }

    // failed は再送キューのジョブが今 run でも配信失敗した件数（catch 経路は send のみが throw）。
    // 送達失敗の無音を防ぐため run 単位で集約通知する。deadLettered（再送上限到達・二度と
    // 自動再送されない件数）を渡し、alertDeliveryFailures 側で文言を「dead-letter」向けに
    // 差し替える（0件時は他 cron と同じ既存文言のまま＝挙動不変）。
    alertDeliveryFailures('webhook-retry', failed, { success }, deadLettered);

    // pending 滞留件数を観測する（backlog の可視化・発症前検知）。エラー時は本体を落とさず
    // null のまま記録する（観測失敗が cron 本体の成否に影響してはならない）。
    let queuePending: number | null = null;
    try {
      const { count } = await supabase
        .from('webhook_retry_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      queuePending = count ?? null;
    } catch (e) {
      console.error('[webhook-retry] queue_pending observation failed (continuing)', { err: errorMessage(e) });
    }

    await logCronRun('webhook-retry', 'success', startedAt, {
      processed: success,
      skipped: failed,
      meta: { total: jobs.length, claimed: claimedJobs.length, queue_pending: queuePending },
    });

    return NextResponse.json({ processed: success, skipped: failed });
  } catch (e) {
    await logCronRun('webhook-retry', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
