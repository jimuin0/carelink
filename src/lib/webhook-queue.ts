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
import { alertWarning } from './alert';

export type WebhookType = 'line_push' | 'line_multicast' | 'email';

export interface WebhookJob {
  type: WebhookType;
  targetId: string;          // LINE user_id or email address
  payload: Record<string, unknown>;
  facilityId?: string | null;
}

const RETRY_DELAYS_MS = [0, 5 * 60 * 1000, 30 * 60 * 1000]; // 即時・5分・30分

/**
 * target_id をログ／アラートに出す前にマスクする。メールアドレスは先頭1文字＋ドメインのみ
 * 残す（`a***@example.com`）。LINE user_id 等 `@` を含まない値は先頭4文字のみ残す。
 * payload 本文（メッセージ内容等）はここでは扱わない＝呼び出し側で出力しないこと。
 */
function maskTargetId(targetId: unknown): string {
  const s = String(targetId);
  if (s.includes('@')) return s.replace(/(.).*@/, '$1***@');
  return s.length <= 4 ? '****' : `${s.slice(0, 4)}****`;
}

/**
 * Webhookをリトライキューに登録する
 */
export async function enqueueWebhook(job: WebhookJob): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('webhook_retry_queue').insert({
      webhook_type:  job.type,
      target_id:     job.targetId,
      payload:       job.payload,
      facility_id:   job.facilityId ?? null,
      attempt_count: 0,
      max_attempts:  3,
      status:        'pending',
      scheduled_at:  new Date().toISOString(),
    });
    // insert() の戻り値 { error } を必ず受け取る。PostgREST は DB レベルの失敗（制約違反・
    // RLS拒否等）を reject でなく戻り値の error に格納するため、これを無視すると catch{} には
    // 到達せず「キュー登録が失敗した＝通知が永久にロストした」ことが完全に無音化する
    // （webhook_retry_queue 自体に一度も行が現れないため後続の再送機構も一切効かない）。
    // payload（メッセージ本文等）はログに出さず、target_id はメールアドレス等の可能性がある
    // ためマスクして出力する（発症前可視化・機密は伏せる）。
    if (error) {
      console.error('[webhook-queue] enqueue failed — notification may be permanently lost', {
        webhookType: job.type,
        targetId: maskTargetId(job.targetId),
        facilityId: job.facilityId ?? null,
        err: error,
      });
      alertWarning(`[webhook-queue] enqueue失敗 — 通知が永久にロストした可能性（${job.type}）`, {
        extra: {
          webhookType: job.type,
          targetId: maskTargetId(job.targetId),
          facilityId: job.facilityId ?? null,
          errMessage: error.message,
        },
      });
    }
  } catch (e) {
    // ネットワーク例外等。キュー登録失敗でも本体処理は止めないが、可視化はする。
    console.error('[webhook-queue] enqueue threw', {
      webhookType: job.type,
      targetId: maskTargetId(job.targetId),
      facilityId: job.facilityId ?? null,
      err: e instanceof Error ? e.message : String(e),
    });
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
 * @returns 'dead-letter'（再送上限到達・status='failed'・二度と自動再送されない）
 *          または 'rescheduled'（status='pending' に戻し次回試行を予約した）。
 *          呼び出し側（route.ts）はこれを集計し、alertDeliveryFailures に
 *          dead-letter 件数を渡して「再送されます」という嘘の文言を防ぐ。
 */
export async function scheduleRetry(
  jobId: string,
  attempt: number,
  errorMsg: string
): Promise<'dead-letter' | 'rescheduled'> {
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
    return 'dead-letter';
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
    // pending へ戻す＝この行は「未 claim」状態に戻る。claimed_at を残したままだと
    // stale reclaim（route.ts）が古い claimed_at を見て「processing のまま孤児化した」と
    // 誤認しかねない（本来 status='processing' の行だけが reclaim 対象だが、値の意味を
    // 一貫させるため pending 復帰時は必ずクリアする）。
    claimed_at: null,
  }).eq('id', jobId);
  if (retryErr) console.error('[webhook-queue] failed to reschedule job — job stuck in processing', { jobId, attempt, err: retryErr });
  return 'rescheduled';
}
