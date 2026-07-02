/**
 * Cronジョブ実行ログヘルパー（v8.32）
 * 各cronルートから呼び出してcron_logsテーブルに結果を記録する
 */

import { createServiceRoleClient } from './supabase-server';
import { alertCaughtError } from './alert';

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

    // insert() の戻り値 { error } を必ず受け取る。Supabase クライアントは DB レベルの
    // 失敗（RLS拒否・制約違反等）を reject でなく戻り値の error に格納するため、この
    // 戻り値を無視すると catch{} は到達せず insert 失敗が完全に不可視化される
    // （実際に「配信は成功したのに cron_logs にログが無い」と誤解される事案があった）。
    // 本体処理は止めない方針は維持しつつ、失敗自体は console.error で可視化する。
    const { error: insertErr } = await supabase.from('cron_logs').insert({
      job_name: jobName,
      status,
      started_at: startedAt.toISOString(),
      duration_ms,
      processed: result.processed ?? 0,
      skipped: result.skipped ?? 0,
      error_msg: result.error_msg ?? null,
      meta: result.meta ?? null,
    });
    if (insertErr) {
      console.error('[cron-logger] cron_logs insert failed — this run will be invisible in monitoring', {
        jobName, status, err: insertErr,
      });
    }
  } catch (e) {
    // ネットワーク例外等。ログ記録の失敗で本体処理は止めないが、可視化はする。
    console.error('[cron-logger] cron_logs insert threw', { jobName, status, err: e });
  }

  // cron 失敗は Slack に通報する（L7-A: logger.error → 30秒以内通知 の cron 版）。
  // 各 cron ルートは error を catch → logCronRun('error') → 500 を return する設計で
  // re-throw しないため instrumentation.ts の onRequestError に伝播せず、ここが
  // 全ジョブ共通の唯一の通報チョークポイント。新規 cron も自動で通報対象になる。
  // commit_sha / env の付与は alertCaughtError 内に集約済みのものを再利用する
  // （env 依存の分岐を本ファイルに重複させない＝到達不能ブランチを作らない）。
  // alertCaughtError は fire-and-forget・throw せず、SLACK 未設定（テスト/開発）
  // では即 return するため本体・テストへの副作用はない。DB 記録の成否に依存させ
  // ないため try/catch の外に置く（記録失敗時こそ通報が必要）。
  if (status === 'error') {
    alertCaughtError(`cron:${jobName}`, new Error(result.error_msg ?? 'unknown error'), `/api/cron/${jobName}`);
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
