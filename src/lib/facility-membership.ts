import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 監査A2の根治ヘルパー（admin/jobs/route.tsの既存パターンを共通化）。
 *
 * 背景: white-label・gbp/place・gbp/posts の各管理APIは、リクエストから facility_id を
 * 受け取らず「そのユーザーがowner/adminの施設」を `.limit(1).single()` で1件だけ取得し、
 * その施設に対して操作していた。複数施設のowner/admin（チェーン運用オーナー）の場合、
 * DBの返却順に依存して意図しない自店とは別の施設のドメイン設定・GBP投稿を操作しうる
 * 非決定的バグだった。facility_id をリクエストで受け取り所属集合で検証する方式に統一する。
 */

/** ユーザーがowner/adminの施設ID一覧を返す。 */
export async function getAdminFacilityIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .in('role', ['owner', 'admin']);
  return (data ?? []).map((m) => m.facility_id as string);
}

export type ResolveFacilityReason = 'ok' | 'forbidden' | 'ambiguous' | 'none';

/**
 * リクエストの facility_id 指定と所属集合を突合し、対象施設IDを決定する。
 * - 指定あり: 所属集合に含まれるかを検証（含まれなければ forbidden）
 * - 指定なし: 単一施設なら自動選択、複数施設なら ambiguous（要指定）
 * - 所属施設がゼロ: none
 */
export function resolveTargetFacilityId(
  facilityIds: string[],
  requestedFacilityId: unknown,
): { facilityId: string | null; reason: ResolveFacilityReason } {
  if (facilityIds.length === 0) return { facilityId: null, reason: 'none' };
  if (typeof requestedFacilityId === 'string' && requestedFacilityId.length > 0) {
    if (!facilityIds.includes(requestedFacilityId)) return { facilityId: null, reason: 'forbidden' };
    return { facilityId: requestedFacilityId, reason: 'ok' };
  }
  if (facilityIds.length === 1) return { facilityId: facilityIds[0], reason: 'ok' };
  return { facilityId: null, reason: 'ambiguous' };
}
