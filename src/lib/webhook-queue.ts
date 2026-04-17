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
 */
export async function scheduleRetry(
  jobId: string,
  attempt: number,
  errorMsg: string
): Promise<void> {
  const supabase = createServiceRoleClient();

  if (attempt >= 3) {
    // 最大リトライ回数超過 → failed
    await supabase.from('webhook_retry_queue').update({
      status: 'failed',
      last_error: errorMsg,
      attempt_count: attempt,
      processed_at: new Date().toISOString(),
    }).eq('id', jobId);
    return;
  }

  const delayMs = RETRY_DELAYS_MS[attempt] ?? 30 * 60 * 1000;
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  await supabase.from('webhook_retry_queue').update({
    status: 'pending',
    attempt_count: attempt,
    last_error: errorMsg,
    scheduled_at: scheduledAt,
  }).eq('id', jobId);
}
