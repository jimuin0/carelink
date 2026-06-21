import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from './err';

/**
 * 予約が completed から離脱（no_show 等）した際、完了時に付与した副作用を取り消す。
 *
 * - customer_visits（来店記録）を booking_id で削除（残ると顧客一覧/来店履歴に幻の来店が残る）。
 * - user_points（来店ポイント）を booking_id で削除（残ると客が来ていない来店のポイントを保持）。
 *   ※ 売上集計は status='completed' フィルタのため status 変更だけで自動是正される（ここでは触らない）。
 *   ※ 付与ポイントを既に使用済みの場合、削除で残高が一時的に負になり得るが、これは「本来得るべきで
 *      なかったポイント」の正しい巻き戻しであり、以後の獲得で自然回復する（予約時の残高 CAS が負利用を防ぐ）。
 *
 * 失敗は致命でないため warn のみ（admin は service_role クライアントを渡すこと）。冪等（booking_id キー）。
 */
export async function reverseCompletionSideEffects(admin: SupabaseClient, bookingId: string): Promise<void> {
  const { error: visitErr } = await admin.from('customer_visits').delete().eq('booking_id', bookingId);
  if (visitErr) {
    console.error('[booking-reversal] customer_visits delete failed', { bookingId, err: errorMessage(visitErr) });
  }
  const { error: pointErr } = await admin.from('user_points').delete().eq('booking_id', bookingId);
  if (pointErr) {
    console.error('[booking-reversal] user_points delete failed', { bookingId, err: errorMessage(pointErr) });
  }
}
