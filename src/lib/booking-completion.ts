import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';
import { awardReferralPointsOnCompletion } from './referral';

/**
 * 予約が completed に「進入」した際に付与する副作用。reverseCompletionSideEffects の対称形。
 *
 * - customer_visits（来店記録）を1件挿入。これは顧客一覧（getUniqueCustomers）の
 *   「来店回数・最終来店」集計の唯一の元データであり、ここが積まれないと予約客が
 *   顧客台帳に来店実績ゼロで埋もれる（8体監査の追検証で確定した本番無音バグの根治）。
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
  // customer_visits 表示用にメニュー名・スタッフ名を解決（任意・失敗時は null のまま）
  let menuName: string | null = null;
  let staffName: string | null = null;
  if (booking.menu_id) {
    const { data: menu } = await admin.from('facility_menus').select('name').eq('id', booking.menu_id).single();
    menuName = menu?.name ?? null;
  }
  if (booking.staff_id) {
    const { data: staff } = await admin.from('staff_profiles').select('name').eq('id', booking.staff_id).single();
    staffName = staff?.name ?? null;
  }

  const { error: visitError } = await admin.from('customer_visits').insert({
    facility_id: booking.facility_id,
    booking_id: booking.id,
    customer_email: booking.email,
    customer_name: booking.customer_name,
    visit_date: booking.booking_date,
    menu_name: menuName,
    staff_name: staffName,
    amount: booking.total_price,
  });
  if (visitError) {
    safeCaptureException(visitError, 'booking-completion');
    alertCaughtError('booking-completion:visit', visitError, `booking:${booking.id}`);
  }

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
