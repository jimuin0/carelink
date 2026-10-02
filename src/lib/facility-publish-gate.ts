import type { SupabaseClient } from '@supabase/supabase-js';
import { hasConfirmedBookingHours } from './booking-preparation';

export interface PublishReadiness {
  ready: boolean;
  missing: string[];
}

/** Only this known DB invariant is an actionable conflict, not any DB error. */
export function isPublishedLocationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === '23514' && typeof value.message === 'string'
    && value.message.includes('"published_facility_location_present"');
}

/**
 * ネット予約の準備条件。掲載公開の条件とは分離する。
 *
 * メニュー件数は公開側 getFacilityMenus の可視条件(is_published が null または true)と揃える。
 * HPB 反映メニューは is_published=false(下書き)で作られるため、これを数に含めると
 * 「公開メニュー0件なのにネット予約できてしまう」行き止まりを防ぐ。
 *
 * error を握り潰すと DB 障害時に「未充足」と誤判定して予約を不当に拒否/許可しかねないため、
 * 呼び出し側が 500 で顕在化できるよう error を返す。
 */
export async function checkBookingReadiness(
  admin: SupabaseClient,
  facilityId: string
): Promise<{ readiness: PublishReadiness; error: unknown }> {
  const [menu, photo, staff, profile] = await Promise.all([
    admin
      .from('facility_menus')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId)
      .or('is_published.is.null,is_published.eq.true'),
    admin
      .from('facility_photos')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId),
    admin
      .from('staff_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId)
      .eq('is_active', true),
    // 掲載の所在地と公開状態も確認するが、メニュー等はネット予約だけの条件。
    admin
      .from('facility_profiles')
      .select('name, prefecture, city, address, business_hours, status')
      .eq('id', facilityId)
      .single(),
  ]);

  if (menu.error || photo.error || staff.error || profile.error) {
    return {
      readiness: { ready: false, missing: [] },
      error: menu.error ?? photo.error ?? staff.error ?? profile.error,
    };
  }

  const missing: string[] = [];
  if (!profile.data?.name?.trim()) missing.push('施設名を設定してください');
  if ((menu.count ?? 0) < 1) missing.push('メニューを1つ以上登録してください');
  if ((photo.count ?? 0) < 1) missing.push('写真を1枚以上登録してください');
  if ((staff.count ?? 0) < 1) missing.push('スタッフを1人以上登録してください');
  if (!profile.data?.prefecture?.trim()) missing.push('都道府県を設定してください');
  if (!profile.data?.city?.trim()) missing.push('市区町村を設定してください');
  // 下書きでは所在地未入力を許容するが、来店先が分からない状態で公開しない。
  if (!profile.data?.address?.trim()) missing.push('住所を設定してください');
  if (profile.data?.status !== 'published') missing.push('店舗を掲載公開してください');
  if (!hasConfirmedBookingHours(profile.data?.business_hours)) missing.push('全曜日の営業時間・定休日を確認して保存してください');

  return { readiness: { ready: missing.length === 0, missing }, error: null };
}

/** Listing is independent of online booking. Authorization stays in the caller. */
export async function checkPublishReadiness(admin: SupabaseClient, facilityId: string): Promise<{ readiness: PublishReadiness; error: unknown }> {
  const profile = await admin.from('facility_profiles').select('name, prefecture, city, address').eq('id', facilityId).single();
  if (profile.error) return { readiness: { ready: false, missing: [] }, error: profile.error };
  const missing: string[] = [];
  if (!profile.data?.name?.trim()) missing.push('施設名を設定してください');
  if (!profile.data?.prefecture?.trim()) missing.push('都道府県を設定してください');
  if (!profile.data?.city?.trim()) missing.push('市区町村を設定してください');
  if (!profile.data?.address?.trim()) missing.push('住所を設定してください');
  return { readiness: { ready: missing.length === 0, missing }, error: null };
}
