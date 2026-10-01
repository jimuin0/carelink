import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';
import { awardReferralPointsOnCompletion } from './referral';

/**
 * 予約が completed に「進入」した際に付与する副作用。reverseCompletionSideEffects の対称形。
 *
 * - 来店記録は booking_visit_atomic DB trigger が予約の状態変更と同時に保存する。
 *   この関数から再挿入しない。履歴保存失敗時は状態変更そのものがrollbackする。
 * - 来店ポイント（100円=1pt）を user_id があれば付与。
 *
 * 失敗は致命でないため Sentry 通知のみで本体は継続（admin は service_role を渡すこと）。
 * 呼び出し側が status='confirmed'→'completed' を CAS で1回だけ確定してから呼ぶ前提
 * （重複付与防止）。返り値は付与した来店ポイント数。
 *
 * 【不変条件】completed へ進入する全経路で本関数を、completed から離脱する全経路で
 * reverseCompletionSideEffects を必ず対で呼ぶ（対称性）。現在の完了経路は3つ＝
 * /api/booking/complete・/api/admin/booking-status・/api/admin/booking-checkout
 * （退店レジ会計・total_price を確定してから呼ぶ）。新たな完了 / 離脱経路を足す時は
 * apply / reverse の配線を必ず対で追加すること（片側漏れは来店実績・ポイントの無音欠落になる）。
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
  // 来店ポイント（1ポイント=100円）。user_points は authenticated に INSERT ポリシーが無いため
  // service_role（admin）で挿入する。
  // null/0/負値の total_price は floor 後の earned>0 という単一ガードで一括判定する
  // （total_price>0 と pointsEarned>0 の多重ガードは境界が観測不能な等価変異を生むため避ける）。
  let pointsEarned = 0;
  if (booking.user_id) {
    const earned = Math.floor((booking.total_price ?? 0) / 100);
    if (earned > 0) {
      pointsEarned = earned;
      const { error: pointError } = await admin.from('user_points').insert({
        user_id: booking.user_id,
        points: pointsEarned,
        reason: '来店ポイント',
        booking_id: booking.id,
      });
      if (pointError) {
        safeCaptureException(pointError, 'booking-completion');
        alertCaughtError('booking-completion:points', pointError, `booking:${booking.id}`);
      }
    }
  }

  // 紹介ボーナス: 被紹介者の初回予約完了時に紹介者500pt・被紹介者300ptを付与する（A-7 根治）。
  // 適用時の即時付与は捨てアカウント量産で悪用できたため、実来店(予約完了)を付与ゲートにする。
  // points_awarded の CAS で複数完了経路・複数回完了でも二重付与しない。失敗は本体を妨げない。
  if (booking.user_id) {
    await awardReferralPointsOnCompletion(admin, booking.user_id);
  }

  return pointsEarned;
}
