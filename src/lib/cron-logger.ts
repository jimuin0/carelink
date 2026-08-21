/**
 * Cronジョブ実行ログヘルパー（v8.32）
 * 各cronルートから呼び出してcron_logsテーブルに結果を記録する
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from './supabase-server';
import { alertCaughtError } from './alert';
import { pushAdminHeartbeat, type HeartbeatStatus } from './admin-heartbeat';
import { runAfterResponse } from './after-response';
import { toJsonValue } from '@/lib/json-value';
import { errorMessage } from '@/lib/err';

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
      meta: result.meta ? toJsonValue(result.meta) : null,
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

  // admin-dashboard への heartbeat 送信（fire-and-forget・env未設定なら no-op）。
  // status mapping: success→ok（正常完了）/ skipped→degraded（実行はしたが対象なし等で
  // スキップ＝完全な正常でも失敗でもない中間状態）/ error→fail（実行を試みて失敗した積極的証拠）。
  // await しない（cron 本体のレスポンスタイムを heartbeat 送信の待ち時間で汚染しない）。
  const heartbeatStatus: HeartbeatStatus =
    status === 'success' ? 'ok' : status === 'skipped' ? 'degraded' : 'fail';
  runAfterResponse(() => pushAdminHeartbeat(jobName, heartbeatStatus));
}

export interface CronErrorOptions {
  /**
   * レスポンス body の `error` フィールドの文言。省略時は既存呼び出しの多数派である
   * 'Internal error'。既存 route の中には 'Internal Server Error' / 'error' / 'claim failed'
   * のように文言が揃っていない箇所があり、body を1バイトも変えないためにここで指定する。
   */
  message?: string;
  /**
   * logCronRun の第4引数（CronResult）へ merge する追加フィールド。
   * `error_msg` を含めると cause から計算した既定値より優先される
   * （固定文字列の error_msg を渡していた既存呼び出しの再現に使う）。
   */
  extraLog?: Record<string, unknown>;
  /** レスポンス body へ merge する追加フィールド（`error` の隣に足す既存フィールドの再現用）。 */
  extraBody?: Record<string, unknown>;
}

/**
 * cron ルートの「エラーを記録する」と「500 を返す」を1呼び出しに束ねるヘルパー。
 *
 * 背景: 全 API の 500 応答は alertCaughtError 経由の Slack 通知が SSOT だが、cron だけは
 * logCronRun('error', ...) が内部で alertCaughtError を既に呼んでいるため、serverError() 等を
 * 重ねると同一失敗に対し別タグの通知が二重に飛ぶ。そのため cron は「logCronRun → 500 を return」
 * を手書きの規約で守ってきたが、規約は書き忘れを検出できない（新しい cron が logCronRun を
 * 呼び忘れて 500 を返すと無音になる）。この関数は両者を1回の呼び出しに強制し、片方だけを
 * 行うことを構造的に不可能にする。
 *
 * error_msg の作り方は `errorMessage()`（`@/lib/err.ts`）を使う。置き換える前の各 cron 呼び出し
 * （`e instanceof Error ? e.message : String(e)` / `errorMessage(e)` / `error.message` 直読み）は
 * いずれも「Error か、Error でなくとも文字列の `.message` を持つオブジェクト（PostgrestError 等）
 * なら `.message`、それ以外は `String()`」という同じ結果になる。`errorMessage()` はこれを
 * 一箇所に集約した既存ヘルパーで、素の `e instanceof Error` 分岐より対象が広い分
 * （`.message` を持つが Error を継承しない値も拾う）、単純な instanceof 判定に狭めると
 * 一部の呼び出し元（PostgrestError 相当のテスト用スタブ等）で error_msg が変わってしまう。
 * 固定文字列の error_msg を渡していた箇所は `extraLog: { error_msg: '...' }` で上書きする。
 */
export async function cronError(
  jobName: string,
  startedAt: Date,
  cause: unknown,
  opts: CronErrorOptions = {}
): Promise<NextResponse> {
  const error_msg = errorMessage(cause);
  await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
  return NextResponse.json({ error: opts.message ?? 'Internal error', ...opts.extraBody }, { status: 500 });
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
