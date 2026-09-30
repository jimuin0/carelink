/**
 * cron 死活監視 heartbeat
 * GET /api/cron/cron-heartbeat（30分毎・7,37 * * * *）
 *
 * 他 cron ジョブの最新実行を cron_logs から見て、期待間隔を大きく超えて実行されていない
 * ＝スケジューラ停止/設定漏れの疑いがあるジョブを Slack に通報する。cron の「実行されて
 * 失敗」は cron-logger が通報するが「そもそも実行されない」は無音だった穴を塞ぐ。
 * 停止疑いは1本のアラートに集約して洪水を避ける。
 */

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import { getStaleCronJobs } from '@/lib/cron-heartbeat';
import { summarizeDependencyError } from '@/lib/err';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SELF = 'cron-heartbeat';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  try {
    // 自身は他ジョブの停止判定から除外する。cron-heartbeat 自身の停止・GitHub Actions の全停止は
    // /api/health の cron probe が heartbeat の鮮度を直接見て degraded 報告する（監視系の自己監視）。
    const { stale, missing = [], queryErrors } = await getStaleCronJobs(startedAt.getTime(), { excludeName: SELF });

    // 停止疑い、または一部ジョブの判定失敗（DB エラー）があれば通報する。
    // queryErrors のみ（stale 0）でも通報するのは、DB 障害で判定が空振りしたのを無音化しないため。
    if (stale.length > 0 || missing.length > 0 || queryErrors.length > 0) {
      // 1本のアラートに集約（1ジョブ1通知の洪水を避ける）。route を固定キーにすることで、
      // 停止が続く間の再通報は同一 Slack スレッドへ集約される。
      const summary: string[] = [];
      if (stale.length > 0) summary.push(`停止疑い ${stale.length}件`);
      if (missing.length > 0) summary.push(`実行履歴なし ${missing.length}件`);
      if (queryErrors.length > 0) summary.push(`判定失敗 ${queryErrors.length}件`);
      const extra: Record<string, unknown> = {
        stale_jobs: stale.map((s) => s.name),
        missing_jobs: missing.map((s) => s.name),
      };
      if (stale.length > 0) {
        extra.detail = stale
          .map((s) => `• ${s.label}(${s.name}): 最終実行 ${s.ageMinutes}分前 / 閾値 ${s.thresholdMinutes}分`)
          .join('\n');
      }
      if (queryErrors.length > 0) extra.query_errors = queryErrors;
      alertWarning(`cron 死活監視: ${summary.join(' / ')}`, {
        route: `/api/cron/${SELF}`,
        extra,
      });
    }

    await logCronRun(SELF, queryErrors.length > 0 ? 'error' : 'success', startedAt, {
      processed: stale.length + missing.length,
      ...(queryErrors.length > 0 ? { error_msg: 'cron 実行履歴を取得できず死活を判定できませんでした' } : {}),
      meta: { stale: stale.map((s) => s.name), missing: missing.map((s) => s.name), queryErrors },
    });
    return NextResponse.json({ stale: stale.map((s) => s.name), missing: missing.map((s) => s.name), queryErrors }, { status: queryErrors.length > 0 ? 503 : 200 });
  } catch (e) {
    console.error('[cron-heartbeat] Error:', { errorMessage: summarizeDependencyError(e) });
    return cronError(SELF, startedAt, e);
  }
}
