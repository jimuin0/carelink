/**
 * cron 死活監視（heartbeat）の判定ロジック。
 *
 * cron の「実行されて失敗」は cron-logger.ts が Slack 通報するが、「そもそも実行されない
 * （スケジューラ停止・設定漏れ）」は error 行が生成されず無音だった。ここは各ジョブの
 * 最新実行時刻を cron_logs から取り、期待間隔ベースの閾値を超えて古い＝停止疑いのジョブを
 * 返す純粋ロジック（nowMs 注入でテスト決定化）。cron-heartbeat ルートが Slack 通報に、
 * /api/health が全停止の外形報告に使う。
 */

import { createServiceRoleClient } from './supabase-server';
import { CRON_JOBS, cronStaleThresholdMinutes } from './cron-jobs';

export interface StaleCronJob {
  name: string;
  label: string;
  /** 最終実行時刻（ISO）。 */
  lastRunAt: string;
  /** 最終実行からの経過分（四捨五入）。 */
  ageMinutes: number;
  /** stale と判定した閾値（分）。 */
  thresholdMinutes: number;
}

const MS_PER_MIN = 60_000;

/**
 * 停止疑いの cron ジョブ一覧を返す。
 * - excludeName（heartbeat 自身）は対象外。
 * - 実行履歴が無いジョブ（新規追加直後・30日保持切れ）は初回前の誤警報を避けて stale としない。
 * - DB 取得エラーのジョブは判定不能として skip し queryErrors で可視化（誤警報を出さない）。
 */
export async function getStaleCronJobs(
  nowMs: number,
  opts: { excludeName?: string } = {},
): Promise<{ stale: StaleCronJob[]; queryErrors: string[] }> {
  const supabase = createServiceRoleClient();
  const targets = CRON_JOBS.filter((j) => j.name !== opts.excludeName);

  // 各ジョブの最新1件を並列取得（idx_cron_logs_job_started で高速）。
  const results = await Promise.all(
    targets.map(async (job) => {
      const { data, error } = await supabase
        .from('cron_logs')
        .select('started_at')
        .eq('job_name', job.name)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { job, data: data as { started_at: string } | null, error };
    }),
  );

  const stale: StaleCronJob[] = [];
  const queryErrors: string[] = [];

  for (const { job, data, error } of results) {
    if (error) {
      queryErrors.push(`${job.name}: ${error.message}`);
      continue;
    }
    if (!data) continue; // 履歴なし → 誤警報回避
    const ageMinutes = (nowMs - new Date(data.started_at).getTime()) / MS_PER_MIN;
    const thresholdMinutes = cronStaleThresholdMinutes(job);
    if (ageMinutes > thresholdMinutes) {
      stale.push({
        name: job.name,
        label: job.label,
        lastRunAt: data.started_at,
        ageMinutes: Math.round(ageMinutes),
        thresholdMinutes,
      });
    }
  }

  return { stale, queryErrors };
}
