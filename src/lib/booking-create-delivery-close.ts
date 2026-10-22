import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 新規予約の Push / LINE WORKS 通知のうち、【宛先がもう存在しない】と確定した送信を
 * 失敗として閉じる（2026年10月23日 新設）。
 *
 * 🔴 なぜ必要か：以前は端末の購読が失効していて Push サービスが 410 を返しても、送信側が
 * 「届いたか分からない」と同じ扱いにしていた。行は status='processing'・delivery_started_at 付きで
 * 残り、孤児回収にも照合にも拾われず、webhook-retry が 15 分ごとに「結果不明の保留あり」として
 * エラーを通報し続けた（運営が SQL で閉じるまで永久に続く）。
 *
 * 閉じてよいのは、このワーカーが claim して送信開始を記録した行だけ（claimed_at と
 * delivery_started_at の両方が一致）。一致しなければ何も書かず false を返し、
 * 呼び出し側はこれまでどおり結果不明として保留する（二重送信も無音の取りこぼしも作らない）。
 * 例外は投げない（呼び出し元は catch 節の中から呼ぶ）。
 */
export type UndeliverableBookingCreation = { reason: string; status: number | null };

export async function closeUndeliverableBookingCreation(
  db: SupabaseClient,
  job: { id: string; attempt_count: number },
  claimedAt: string,
  startedAt: string,
  outcome: UndeliverableBookingCreation,
): Promise<boolean> {
  try {
    const { data, error } = await db.from('webhook_retry_queue').update({
      status: 'failed',
      attempt_count: job.attempt_count + 1,
      last_error: outcome.reason,
      processed_at: new Date().toISOString(),
    })
      .eq('id', job.id)
      .eq('status', 'processing')
      .eq('claimed_at', claimedAt)
      .eq('delivery_started_at', startedAt)
      .select('id');
    return !error && Array.isArray(data) && data.length === 1 && data[0].id === job.id;
  } catch {
    return false;
  }
}

/** 運営向けの説明（Slack）。宛先そのもの（利用者 ID・チャンネル ID）は載せない。 */
export function describeUndeliverableBookingCreation(webhookType: string, outcome: UndeliverableBookingCreation): string {
  const channel = webhookType === 'booking_creation_lineworks' ? 'LINE WORKS通知' : 'Push通知';
  const detail = outcome.reason === 'booking_push_subscription_expired'
    ? '端末の購読が失効していたため、購読の登録を削除しました'
    : outcome.reason === 'booking_lineworks_channel_not_found'
      ? 'LINE WORKS のチャンネルが見つかりません。スタッフのチャンネル設定をご確認ください'
      : '送信の直前に端末の登録が変わったため、送信しませんでした';
  return `[booking-notification] 新規予約の${channel}を終了しました（${detail}・再送はしません）`;
}
