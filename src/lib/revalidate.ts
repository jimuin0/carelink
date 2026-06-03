import { revalidatePath } from 'next/cache';

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
