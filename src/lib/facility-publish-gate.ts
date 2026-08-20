import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublishReadiness {
  ready: boolean;
  missing: string[];
}

/**
 * 施設を published にできる必須条件（メニュー/写真/アクティブスタッフ 各≥1）を検証する。
 * 単一公開(admin/settings)とチェーン一括公開(admin/chain/bulk-publish)で共有し、
 * 「空の施設が検索に出て予約で行き止まり」を両経路で等しく防ぐ。
 *
 * メニュー件数は公開側 getFacilityMenus の可視条件(is_published が null または true)と揃える。
 * HPB 反映メニューは is_published=false(下書き)で作られるため、これを数に含めると
 * 「公開メニュー0件なのに公開できてしまう」行き止まりが起きる（BP-2 の根治）。
 *
 * error を握り潰すと DB 障害時に「未充足」と誤判定して公開を不当に拒否/許可しかねないため、
 * 呼び出し側が 500 で顕在化できるよう error を返す。
 */
export async function checkPublishReadiness(
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
    // 公開＝「検索で見つかる状態にする」こと。/search の地域絞り込みは
    // facility_profiles.prefecture の完全一致（facilities.ts）で、getSimilarFacilities /
    // getNearbyFacilities も prefecture/city を結合キーに使う。地域が空の施設は
    // 公開してもこの経路に一切乗らず、既存3条件（メニュー/写真/スタッフ）が防いでいるのと
    // 同種の「空の施設が検索に出て予約で行き止まり」を招く。よってここも必須条件にする。
    admin
      .from('facility_profiles')
      .select('prefecture, city')
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
  if ((menu.count ?? 0) < 1) missing.push('メニューを1つ以上登録してください');
  if ((photo.count ?? 0) < 1) missing.push('写真を1枚以上登録してください');
  if ((staff.count ?? 0) < 1) missing.push('スタッフを1人以上登録してください');
  if (!profile.data?.prefecture) missing.push('都道府県を設定してください');
  if (!profile.data?.city) missing.push('市区町村を設定してください');

  return { readiness: { ready: missing.length === 0, missing }, error: null };
}
