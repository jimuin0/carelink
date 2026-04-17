/**
 * Cronジョブ実行ログヘルパー（v8.32）
 * 各cronルートから呼び出してcron_logsテーブルに結果を記録する
 */

import { createServiceRoleClient } from './supabase-server';

export interface CronResult {
  processed?: number;
  skipped?: number;
  error_msg?: string;
  meta?: Record<string, unknown>;
}

/**
 * cronジョブの実行結果をDBに記録する
 * サービスロールクライアントを使用するためRLSをバイパス
 */
export async function logCronRun(
  jobName: string,
  status: 'success' | 'error' | 'skipped',
  startedAt: Date,
  result: CronResult = {}
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const duration_ms = Date.now() - startedAt.getTime();

    await supabase.from('cron_logs').insert({
      job_name: jobName,
      status,
      started_at: startedAt.toISOString(),
      duration_ms,
      processed: result.processed ?? 0,
      skipped: result.skipped ?? 0,
      error_msg: result.error_msg ?? null,
      meta: result.meta ?? null,
    });
  } catch {
    // ログ記録の失敗で本体処理を止めない
  }
}

/**
 * cronジョブを実行しログを記録するラッパー
 * @example
 * export async function GET(request: Request) {
 *   return withCronLog('booking-reminder', async () => {
 *     // 処理本体
 *     return { processed: 5 };
 *   });
 * }
 */
export async function withCronLog<T extends CronResult>(
  jobName: string,
  fn: () => Promise<T>
): Promise<T & { _logged: true }> {
  const startedAt = new Date();
  try {
    const result = await fn();
    await logCronRun(jobName, 'success', startedAt, result);
    return { ...result, _logged: true as const };
  } catch (err) {
    const error_msg = err instanceof Error ? err.message : String(err);
    await logCronRun(jobName, 'error', startedAt, { error_msg });
    throw err;
  }
}
