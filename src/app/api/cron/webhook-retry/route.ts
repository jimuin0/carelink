/**
 * Webhook リトライ Cron（v8.35）
 * GET /api/cron/webhook-retry
 * 15分ごとに実行: 失敗したWebhookを再送する
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { scheduleRetry } from '@/lib/webhook-queue';
import { sendLineText } from '@/lib/line';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { retryTransientSupabaseRead, summarizeDependencyError } from '@/lib/err';
import { fromEnv, resolveFrom } from '@/lib/email-from';
import { sendResendForReconciliation } from '@/lib/resend-result';
import { prepareSalonOutboxDelivery } from '@/lib/salon-outbox-delivery';
import { prepareFacilityWelcomeDelivery } from '@/lib/facility-welcome-delivery';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  try {
    const supabase = createServiceRoleClient();
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
      .update({ status: 'pending', claimed_at: null, delivery_started_at: null })
      .eq('status', 'processing')
      // 外部送信開始を永続化できた行は、送達成功後に DB 応答が失われた可能性がある。
      // これを自動 reclaim すると同じ顧客へ二重送信し得るため、手動照合まで保持する。
      .is('delivery_started_at', null)
      .or(`claimed_at.lt.${staleBefore},and(claimed_at.is.null,scheduled_at.lt.${staleBefore})`);
    if (reclaimErr) {
      console.error('[webhook-retry] stale processing reclaim failed (continuing)', { err: summarizeDependencyError(reclaimErr) });
    }

    // delivery_started_at が残る行は、外部 provider が受理済みの可能性があるため自動 reclaim
    // してはならない。一方、手動照合待ちの行を数えないと、pending が 0 件の run を正常な
    // skipped と記録して障害が監視から消える。1時間を超えて保留している件数を run ごとに
    // 明示し、既存の 503 / cron error 経路で運用へ上げる。
    const { count: heldDeliveryCount, error: heldDeliveryErr } = await supabase
      .from('webhook_retry_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .not('delivery_started_at', 'is', null)
      .lt('delivery_started_at', staleBefore);
    if (heldDeliveryErr) {
      // 結果不明の送達を監視できない状態を正常skippedにすると、保留行が無音で残る。
      // 同じcronが次回に再照合するまで処理を中断し、500とcron errorで可視化する。
      return cronError('webhook-retry', startedAt, heldDeliveryErr, { message: 'held delivery observation failed' });
    }
    let deliveryUncertain = heldDeliveryCount ?? 0;

    // pending かつ scheduled_at が現在時刻以前のジョブを取得
    const { data: jobs, error: jobsError } = await retryTransientSupabaseRead(() =>
      supabase
        .from('webhook_retry_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(50),
    );

    // DB エラーを握り潰すと「0 件＝skipped 成功」に化け、その run が無音でスキップされ Slack 通報も
    // されない。error を error ログ＋500 で可視化する（発症前検知）。
    if (jobsError) {
      return cronError('webhook-retry', startedAt, jobsError, { message: 'Internal Server Error' });
    }

    if (!jobs || jobs.length === 0) {
      if (deliveryUncertain > 0) {
        await logCronRun('webhook-retry', 'error', startedAt, {
          processed: 0,
          skipped: 0,
          error_msg: '外部送信後の結果記録が不明なジョブを再送防止のため保留しました',
          meta: { total: 0, claimed: 0, delivery_uncertain: deliveryUncertain },
        });
        return NextResponse.json({
          error: 'delivery confirmation pending',
          delivery_uncertain: deliveryUncertain,
          processed: 0,
          skipped: 0,
        }, { status: 503 });
      }
      await logCronRun('webhook-retry', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0 });
    }

    // processing に変更（二重実行防止）。
    // 【真のCAS・2026年7月16日】旧実装は `.in('id', jobIds)` のみで `.eq('status','pending')`
    // ガードが無く、SELECT→UPDATE が非原子だった。cron は三重化（GitHub Actions + pg_cron +
    // Render が同一 */15 発火）されており、並行 run が同じ pending 行を SELECT した後に両方が
    // 無条件 UPDATE で claim を「成功」させ、同一ジョブを二重配信し得た。
    // booking-reminder / review-request の claim と同方針の CAS：status='pending' の行だけを
    // processing へ更新し、返却された最新行だけを後続処理対象にする
    // （update 結果の id リストが正）。他 run に先取りされた行は UPDATE の対象外＝返却されず、
    // この run では処理しない（二重送信の発症前予防）。
    const jobIds = jobs.map((j) => j.id);
    // claimed_at＝claim 成功時刻。stale reclaim（上記）はこの値を基準に「本当に processing の
    // まま孤児化したか」を判定する（scheduled_at 流用は二重配信の温床だったため廃止）。
    const claimEpoch = new Date().toISOString();
    const { data: claimedRows, error: claimErr } = await supabase
      .from('webhook_retry_queue')
      .update({ status: 'processing', claimed_at: claimEpoch, delivery_started_at: null })
      .in('id', jobIds)
      .eq('status', 'pending')
      .lte('scheduled_at', claimEpoch)
      .select('*');
    if (claimErr) {
      console.error('[webhook-retry] status claim failed — aborting to prevent duplicate delivery', {
        err: summarizeDependencyError(claimErr),
      });
      return cronError('webhook-retry', startedAt, claimErr, { message: 'claim failed' });
    }
    // data が null（0行更新時のドライバ表現揺れ）も「1行も claim できなかった」として安全側に扱う。
    // Another worker may have rescheduled a selected row in the meantime.
    // Recheck the due time in the UPDATE and use its current payload/attempts.
    const claimedJobs = claimedRows ?? [];
    if (claimedJobs.length === 0) {
      // 全行を並行 run に先取りされた＝この run の仕事は無い（重複配信を作らず正常終了）。
      if (deliveryUncertain > 0) {
        await logCronRun('webhook-retry', 'error', startedAt, {
          processed: 0,
          skipped: 0,
          error_msg: '外部送信後の結果記録が不明なジョブを再送防止のため保留しました',
          meta: { total: jobs.length, claimed: 0, delivery_uncertain: deliveryUncertain },
        });
        return NextResponse.json({
          error: 'delivery confirmation pending',
          delivery_uncertain: deliveryUncertain,
          processed: 0,
          skipped: 0,
        }, { status: 503 });
      }
      await logCronRun('webhook-retry', 'skipped', startedAt, { processed: 0, skipped: 0, meta: { total: jobs.length, claimed: 0 } });
      return NextResponse.json({ processed: 0, skipped: 0 });
    }

    let success = 0;
    let failed = 0;
    let deadLettered = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const job of claimedJobs) {
      // 外部送信の開始前だけは安全に retry queue へ戻せる。開始後に timeout / 接続断 /
      // Promise reject が起きた場合は、provider が受理済みかをこのプロセスから判定できない。
      // その行を pending に戻すと同じ利用者への二重送信になるため、delivery_started_at を
      // 保持したまま運用照合へ上げる。
      let deliveryAttempted = false;
      let definitelyRejected = false;
      try {
        // 送信前に payload と設定を検証する。この段階の失敗には外部効果がないので、
        // scheduleRetry による通常の再試行が安全である。
        let deliver: () => Promise<void>;
        if (job.webhook_type === 'salon_registration_email' || job.webhook_type === 'salon_registration_internal'
          || job.webhook_type === 'facility_welcome') {
          const sendRegistration = job.webhook_type === 'facility_welcome'
            ? await prepareFacilityWelcomeDelivery(supabase, job, resend)
            : await prepareSalonOutboxDelivery(supabase, job, resend);
          deliver = async () => {
            const outcome = await sendRegistration();
            definitelyRejected = outcome === 'rejected';
            if (outcome !== 'delivered') throw new Error('registration notification delivery not confirmed');
          };
        } else if (job.webhook_type === 'line_push') {
          const payload = job.payload;
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
            throw new Error('line_push payload is not an object');
          }
          const message = payload.message;
          if (typeof message !== 'string') {
            throw new Error('line_push payload.message is missing or not a string');
          }
          deliver = async () => {
            const ok = await sendLineText(job.target_id, message);
            if (!ok) throw new Error('line_push failed after all retries');
          };
        } else if (job.webhook_type === 'email') {
          if (!resend) throw new Error('email skipped: RESEND_API_KEY not configured');
          const payload = job.payload;
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
            throw new Error('email payload is not an object');
          }
          const { to, subject, html, from } = payload as { to?: unknown; subject?: unknown; html?: unknown; from?: unknown };
          if (typeof to !== 'string' || typeof subject !== 'string' || typeof html !== 'string' || (from !== undefined && typeof from !== 'string')) {
            throw new Error('email payload is invalid');
          }
          deliver = async () => {
            const outcome = await sendResendForReconciliation(resend.emails.send({
              from: from ? resolveFrom(from, process.env.NODE_ENV === 'production').from : fromEnv(),
              to,
              subject,
              html,
            }));
            definitelyRejected = outcome === 'rejected';
            if (outcome !== 'delivered') throw new Error('email delivery not confirmed');
          };
        } else {
          throw new Error(`unsupported webhook_type: ${String(job.webhook_type)}`);
        }

        // 外部送信より先に「送信開始」を永続化する。ここが成功した後でのみ送信するため、
        // 送達後の success 更新が 522 等で不明になっても stale reclaim は再送しない。
        // この write が失敗した場合は送信を始めないため、scheduleRetry 経由の安全な再試行が可能。
        const deliveryStartedAt = new Date().toISOString();
        const { data: startedRows, error: deliveryStartErr } = await supabase
          .from('webhook_retry_queue')
          .update({ delivery_started_at: deliveryStartedAt })
          .eq('id', job.id)
          .eq('status', 'processing')
          .eq('claimed_at', claimEpoch)
          .is('delivery_started_at', null)
          .select('id');
        if (deliveryStartErr) throw deliveryStartErr;
        // A paused worker can outlive reclaim. Ownership must still match at
        // the irreversible boundary, not just at the initial claim.
        if (startedRows?.length !== 1) {
          deliveryUncertain++;
          continue;
        }

        // `deliver()` が reject / false を返した時点では provider が受理した可能性を否定できない。
        // 呼び出し直前に立てることで、送信開始の保存失敗とは厳密に分離する。
        deliveryAttempted = true;
        await deliver();

        // 成功。配信（メール/LINE）は冪等でないため、ここで status='success' に確実に倒さないと
        // 行が processing のまま残り、上部の stale reclaim 経由で pending に戻され次 run で再送＝
        // 二重配信になる。旧実装はこの更新の error を握り潰していた（claim 路・失敗路は
        // error を扱うのにここだけ欠落）。一過性 DB エラーに備え限定リトライし、全敗時のみ CRITICAL で
        // 可視化する（配信済みのため scheduleRetry で再送に回してはならない）。
        let marked = false;
        for (let attempt = 0; attempt < 3 && !marked; attempt++) {
          const { data: successRows, error: successErr } = await supabase
            .from('webhook_retry_queue')
            .update({
              status: 'success',
              attempt_count: job.attempt_count + 1,
              processed_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
            })
            .eq('id', job.id)
            .eq('status', 'processing')
            .eq('claimed_at', claimEpoch)
            .eq('delivery_started_at', deliveryStartedAt)
            .select('id');
          if (!successErr && successRows?.length === 1) {
            marked = true;
          } else {
            console.error('[webhook-retry] success mark failed (retrying)', {
              jobId: job.id,
              attempt: attempt + 1,
              err: summarizeDependencyError(successErr),
            });
          }
        }
        if (!marked) {
          // delivery_started_at が残るため stale reclaim はこの行を拾わない。外部送信済みの
          // 可能性がある行を自動再送するより、手動照合まで保留する方が安全である。
          console.error('[webhook-retry] CRITICAL: delivered but could not mark success — held to prevent duplicate delivery', { jobId: job.id });
          deliveryUncertain++;
        }
        success++;
      } catch (e) {
        const errorMsg = summarizeDependencyError(e);
        if (deliveryAttempted && !definitelyRejected) {
          console.error('[webhook-retry] delivery outcome uncertain — held to prevent duplicate delivery', {
            jobId: job.id,
            err: errorMsg,
          });
          deliveryUncertain++;
          continue;
        }
        const outcome = await scheduleRetry(job.id, job.attempt_count + 1, errorMsg, claimEpoch);
        // scheduleRetry の戻り値で dead-letter（再送上限到達・status='failed'・二度と自動
        // 再送されない）とrescheduled（次回試行を予約）を区別する。区別しないと
        // alertDeliveryFailures が dead-letter 分にも「翌runで再送」という嘘の文言を出す。
        if (outcome === 'uncertain') {
          // 送信失敗後でも、pending/failed への書込み結果が不明なら自動再送は危険。
          // delivery_started_at を残したまま運用照合へ上げ、成功として隠さない。
          deliveryUncertain++;
        } else {
          if (outcome === 'dead-letter') deadLettered++;
          failed++;
        }
      }
    }

    // failed は再送キューのジョブが今 run でも配信失敗した件数（catch 経路は send のみが throw）。
    // 送達失敗の無音を防ぐため run 単位で集約通知する。deadLettered（再送上限到達・二度と
    // 自動再送されない件数）を渡し、alertDeliveryFailures 側で文言を「dead-letter」向けに
    // 差し替える（0件時は他 cron と同じ既存文言のまま＝挙動不変）。
    alertDeliveryFailures('webhook-retry', failed, { success }, deadLettered);
    if (deliveryUncertain > 0) {
      await logCronRun('webhook-retry', 'error', startedAt, {
        processed: success,
        skipped: failed,
        error_msg: '外部送信後の結果記録が不明なジョブを再送防止のため保留しました',
        meta: { total: jobs.length, claimed: claimedJobs.length, delivery_uncertain: deliveryUncertain },
      });
      return NextResponse.json({
        error: 'delivery confirmation pending',
        delivery_uncertain: deliveryUncertain,
        processed: success,
        skipped: failed,
      }, { status: 503 });
    }

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
      console.error('[webhook-retry] queue_pending observation failed (continuing)', {
        err: summarizeDependencyError(e),
      });
    }

    await logCronRun('webhook-retry', 'success', startedAt, {
      processed: success,
      skipped: failed,
      meta: { total: jobs.length, claimed: claimedJobs.length, queue_pending: queuePending, delivery_uncertain: 0 },
    });

    return NextResponse.json({ processed: success, skipped: failed });
  } catch (e) {
    return cronError('webhook-retry', startedAt, e);
  }
}
