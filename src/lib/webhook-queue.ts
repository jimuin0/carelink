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
 * @param attempt 直前まで完了した試行回数（0=初回失敗, 1=1回目リトライ失敗, 2=2回目リトライ失敗）
 *               attempt >= max_attempts(3) で dead-letter に移行
 * @param errorMsg エラーメッセージ
 */
export async function scheduleRetry(
  jobId: string,
  attempt: number,
  errorMsg: string
): Promise<void> {
  const supabase = createServiceRoleClient();

  // attempt は「今失敗した試行番号」(0-indexed)。max_attempts=3 なので attempt >= 3 で全試行消化済み
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

  // 次回試行のディレイ: RETRY_DELAYS_MS[attempt+1] を使う（attempt=0の失敗→次回は1回目リトライ=5分後）
  const nextAttempt = attempt + 1;
  const delayMs = RETRY_DELAYS_MS[nextAttempt] ?? 30 * 60 * 1000;
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  const { error: retryErr } = await supabase.from('webhook_retry_queue').update({
    status: 'pending',
    attempt_count: nextAttempt,   // 次回試行番号を記録（ワーカーは attempt_count を読んで scheduleRetry に渡す）
    last_error: errorMsg,
    scheduled_at: scheduledAt,
  }).eq('id', jobId);
  if (retryErr) console.error('[webhook-queue] failed to reschedule job — job stuck in processing', { jobId, attempt: nextAttempt, err: retryErr });
}
