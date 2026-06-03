import { revalidatePath } from 'next/cache';
import { createServiceRoleClient } from '@/lib/supabase-server';

/**
 * 施設の公開ページ（ISR キャッシュ）を on-demand 再検証する共有窓口（round6）。
 * 公開ページは revalidate=3600 の時間ベース ISR のみで、管理側の更新（公開/非公開・メニュー・
 * クーポン・スタッフ・写真・ブログ等）が最大1時間反映されなかった。書込点からこの関数を呼ぶことで
 * 該当施設の公開ページを即時失効させる。slug 未確定時は何もしない（防御）。
 *
 * 'layout' 指定で /facility/[slug] 配下（詳細・catalog・blog・staff 等のサブページ）をまとめて失効する。
 */
export function revalidateFacilityPublicPages(slug: string | null | undefined): void {
  if (!slug) return;
  revalidatePath(`/facility/${slug}`, 'layout');
}

/**
 * facility_id から slug を解決して公開ページを再検証する。メニュー/クーポン/スタッフ/写真/ブログ等
 * 施設配下コンテンツの更新点から呼ぶための窓口（slug を持たない route 向け）。失敗は握って無視する
 * （再検証は本処理の付随処理であり、失敗で本処理を巻き戻さない）。
 */
export async function revalidateFacilityById(facilityId: string): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.from('facility_profiles').select('slug').eq('id', facilityId).single();
    revalidateFacilityPublicPages((data as { slug?: string } | null)?.slug);
  } catch {
    // 再検証失敗は本処理に影響させない
  }
}
