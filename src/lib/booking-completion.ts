import type { SupabaseClient } from '@supabase/supabase-js';
import { awardReferralPointsOnCompletion } from './referral';

/**
 * 予約が completed に「進入」した際に付与する副作用。reverseCompletionSideEffects の対称形。
 *
 * - 来店記録は booking_visit_atomic DB trigger が予約の状態変更と同時に保存する。
 *   この関数から再挿入しない。履歴保存失敗時は状態変更そのものがrollbackする。
 * - 来店ポイント（100円=1pt）を user_id があれば付与。
 *
 * 来店記録・ポイント保存失敗はDB transactionそのものをrollbackする。ここは保存後の紹介処理のみ。
 * 呼び出し側がcompletedへの遷移またはDBで確認した完了のreplay後に呼ぶ。
 * 返り値は表示用の算出額。確定した付与額が必要ならtransactionの結果を使う。
 *
 * 任意の紹介報酬の回復を可能にするため、現在の完了経路3つで本関数を呼ぶ＝
 * /api/booking/complete・/api/admin/booking-status・/api/admin/booking-checkout
 * （退店レジ会計・total_price を確定してから呼ぶ）。来店記録とポイントの保存・取消は
 * DBトリガが同じtransaction内で処理し、アプリから二度目の台帳更新をしない。
 */
export interface CompletableBooking {
  id: string;
  facility_id: string;
  user_id: string | null;
  customer_name: string;
  email: string | null;
  booking_date: string;
  total_price: number | null;
  menu_id: string | null;
  staff_id: string | null;
}

export async function applyCompletionSideEffects(
  admin: SupabaseClient,
  booking: CompletableBooking,
): Promise<number> {
  // booking_points_atomic が状態・来店記録と一緒に保存済み。ここでは再挿入しない。
  const pointsEarned = booking.user_id ? Math.max(0, Math.floor((booking.total_price ?? 0) / 100)) : 0;

  // 紹介ボーナス: 被紹介者の初回予約完了時に紹介者500pt・被紹介者300ptを付与する（A-7 根治）。
  // 適用時の即時付与は捨てアカウント量産で悪用できたため、実来店(予約完了)を付与ゲートにする。
  // points_awarded の CAS で複数完了経路・複数回完了でも二重付与しない。失敗は本体を妨げない。
  if (booking.user_id) {
    await awardReferralPointsOnCompletion(admin, booking.user_id);
  }

  return pointsEarned;
}
