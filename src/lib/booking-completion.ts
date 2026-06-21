import type { SupabaseClient } from '@supabase/supabase-js';
import { safeCaptureException } from './safe';

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
  }

  // 来店ポイント（1ポイント=100円）。user_points は authenticated に INSERT ポリシーが無いため
  // service_role（admin）で挿入する。
  let pointsEarned = 0;
  if (booking.user_id && booking.total_price && booking.total_price > 0) {
    pointsEarned = Math.floor(booking.total_price / 100);
    if (pointsEarned > 0) {
      const { error: pointError } = await admin.from('user_points').insert({
        user_id: booking.user_id,
        points: pointsEarned,
        reason: '来店ポイント',
        booking_id: booking.id,
      });
      if (pointError) {
        safeCaptureException(pointError, 'booking-completion');
      }
    }
  }
  return pointsEarned;
}
