/**
 * Webhook リトライキューヘルパー（v8.35）
 * LINE通知・メール送信の失敗時にリトライキューに登録する
 *
 * リトライスケジュール（指数バックオフ）:
 *   1回目: 即時
 *   2回目: 5分後
 *   3回目: 30分後
 *   以降: failed
 */

import { createServiceRoleClient } from './supabase-server';

export type WebhookType = 'line_push' | 'line_multicast' | 'email';

export interface WebhookJob {
  type: WebhookType;
  targetId: string;          // LINE user_id or email address
  payload: Record<string, unknown>;
  facilityId?: string | null;
}

const RETRY_DELAYS_MS = [0, 5 * 60 * 1000, 30 * 60 * 1000]; // 即時・5分・30分

/**
 * Webhookをリトライキューに登録する
 */
export async function enqueueWebhook(job: WebhookJob): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from('webhook_retry_queue').insert({
      webhook_type:  job.type,
      target_id:     job.targetId,
      payload:       job.payload,
      facility_id:   job.facilityId ?? null,
      attempt_count: 0,
      max_attempts:  3,
      status:        'pending',
      scheduled_at:  new Date().toISOString(),
    });
  } catch {
    // キュー登録失敗でも本体処理を止めない
  }
}

/**
 * 失敗したWebhookを次の試行時刻に再スケジュールする
 * @param jobId  ジョブID
 * @param attempt 今まで完了した（失敗した）試行回数。ワーカーは送信失敗時に
 *               `job.attempt_count + 1` を渡す（1=即時失敗, 2=5分後失敗, 3=30分後失敗）。
 *               次回ディレイは「完了済み回数」で索引する（1→5分後・2→30分後）。
 *               attempt >= max_attempts(3) で全試行消化済み → dead-letter に移行。
 * @param errorMsg エラーメッセージ
 */
export async function scheduleRetry(
  jobId: string,
  attempt: number,
  errorMsg: string
): Promise<void> {
  const supabase = createServiceRoleClient();

  // attempt は「今まで完了した試行回数」。max_attempts=3 なので attempt >= 3 で全試行消化済み
  if (attempt >= 3) {
    // 最大リトライ回数超過 → dead-letter（failed）
    const { error: failErr } = await supabase.from('webhook_retry_queue').update({
      status: 'failed',
      last_error: errorMsg,
      attempt_count: attempt,
      processed_at: new Date().toISOString(),
    }).eq('id', jobId);
    if (failErr) console.error('[webhook-queue] failed to mark job as failed — job stuck in processing', { jobId, err: failErr });
    return;
  }

  // 次回試行のディレイ＝完了済み試行回数で索引する。
  // 1回完了（即時失敗）→ RETRY_DELAYS_MS[1]=5分後、2回完了 → RETRY_DELAYS_MS[2]=30分後。
  // 以前は attempt+1 で索引していたため 5分層が一度も使われず（即時→30分の2回で打ち切り）、
  // docstring の「即時・5分・30分」3回試行を満たしていなかった（通知の到達信頼性を毀損）。
  // 上の guard で attempt>=3 は return 済み・ワーカーは attempt_count+1(>=1) を渡すため、
  // ここでの attempt は必ず 1 か 2 ＝ RETRY_DELAYS_MS の有効添字。フォールバックは不要。
  const delayMs = RETRY_DELAYS_MS[attempt];
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  const { error: retryErr } = await supabase.from('webhook_retry_queue').update({
    status: 'pending',
    attempt_count: attempt,   // 完了済み試行回数を記録（ワーカーは attempt_count+1 を次回 scheduleRetry へ渡す）
    last_error: errorMsg,
    scheduled_at: scheduledAt,
  }).eq('id', jobId);
  if (retryErr) console.error('[webhook-queue] failed to reschedule job — job stuck in processing', { jobId, attempt, err: retryErr });
}
