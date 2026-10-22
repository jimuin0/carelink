import type { SupabaseClient } from '@supabase/supabase-js';
import { hasConfirmedBookingHours } from './booking-preparation';
import { validateFacilityPrText } from './medical-ad-guard';

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

  const missing = bookingReadinessMissing({
    name: profile.data?.name,
    prefecture: profile.data?.prefecture,
    city: profile.data?.city,
    hasAddress: Boolean(profile.data?.address?.trim()),
    status: profile.data?.status,
    businessHours: profile.data?.business_hours,
    menuCount: menu.count ?? 0,
    photoCount: photo.count ?? 0,
    staffCount: staff.count ?? 0,
  });
  return { readiness: { ready: missing.length === 0, missing }, error: null };
}

export interface BookingReadinessInput {
  name?: string | null;
  prefecture?: string | null;
  city?: string | null;
  hasAddress: boolean;
  status?: string | null;
  businessHours?: unknown;
  menuCount: number;
  photoCount: number;
  staffCount: number;
}

/**
 * The single online-booking rule. The booking page, the slot APIs and the
 * search card's 「予約OK」 badge all use it, so a card can never advertise
 * booking that the facility page then refuses.
 */
export function bookingReadinessMissing(input: BookingReadinessInput): string[] {
  const missing: string[] = [];
  if (!input.name?.trim()) missing.push('施設名を設定してください');
  if (input.menuCount < 1) missing.push('メニューを1つ以上登録してください');
  if (input.photoCount < 1) missing.push('写真を1枚以上登録してください');
  if (input.staffCount < 1) missing.push('スタッフを1人以上登録してください');
  if (!input.prefecture?.trim()) missing.push('都道府県を設定してください');
  if (!input.city?.trim()) missing.push('市区町村を設定してください');
  // 下書きでは所在地未入力を許容するが、来店先が分からない状態で公開しない。
  if (!input.hasAddress) missing.push('住所を設定してください');
  if (input.status !== 'published') missing.push('店舗を掲載公開してください');
  if (!hasConfirmedBookingHours(input.businessHours)) missing.push('全曜日の営業時間・定休日を確認して保存してください');
  return missing;
}

/**
 * A search card is advertised as bookable only when facility_card_view carries
 * the readiness inputs and they satisfy the same rule. Cards built from sources
 * without those inputs are never advertised (fail closed, no false 「予約OK」).
 */
export function isCardBookingReady(card: {
  name: string; prefecture: string; city: string; business_hours: unknown; photo_count: number;
  booking_menu_count?: number | null; active_staff_count?: number | null; has_address?: boolean | null;
}): boolean {
  if (card.booking_menu_count == null || card.active_staff_count == null || card.has_address == null) return false;
  return bookingReadinessMissing({
    name: card.name, prefecture: card.prefecture, city: card.city, hasAddress: card.has_address,
    status: 'published', businessHours: card.business_hours,
    menuCount: card.booking_menu_count, photoCount: card.photo_count, staffCount: card.active_staff_count,
  }).length === 0;
}

/** 公開ゲートで医療広告の表現を見直す PR 文言の列と、オーナーに見せる欄名。 */
const PR_TEXT_FIELDS = [['catch_copy', 'キャッチコピー'], ['description', '施設紹介']] as const;

/** Listing is independent of online booking. Authorization stays in the caller. */
export async function checkPublishReadiness(admin: SupabaseClient, facilityId: string): Promise<{ readiness: PublishReadiness; error: unknown }> {
  const profile = await admin.from('facility_profiles').select('name, prefecture, city, address, catch_copy, description').eq('id', facilityId).single();
  if (profile.error) return { readiness: { ready: false, missing: [] }, error: profile.error };
  const missing: string[] = [];
  if (!profile.data?.name?.trim()) missing.push('施設名を設定してください');
  if (!profile.data?.prefecture?.trim()) missing.push('都道府県を設定してください');
  if (!profile.data?.city?.trim()) missing.push('市区町村を設定してください');
  if (!profile.data?.address?.trim()) missing.push('住所を設定してください');
  // 最後の砦。/admin/settings は保存時に弾くが、/register の PR 文（取り込み後は施設紹介）など
  // 設定画面を経ずに入った文言は検査されないまま公開できた。公開の瞬間にも同じ判定を通す。
  for (const [field, label] of PR_TEXT_FIELDS) {
    const check = validateFacilityPrText(profile.data?.[field]);
    if (!check.ok) missing.push(`${label}：${check.message}`);
  }
  return { readiness: { ready: missing.length === 0, missing }, error: null };
}
