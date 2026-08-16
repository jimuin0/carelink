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
 * `resolveTargetFacilityId` の戻り値。判別可能合併（discriminated union）にしてある。
 *
 * 🔴 なぜ `{ facilityId: string | null; reason }` ではないか:
 * 相関を型で表現していないと、呼び出し側が reason を全て潰したあとでも facilityId は
 * `string | null` のままになる。その結果どの呼び出し元も「実際には絶対に起きない
 * `if (!facilityId)` ガード」を書かされ、しかもブランチカバレッジ 100% ゲートがあるため
 * 【起こり得ない状態を人為的に注入するテスト】まで書く羽目になる（実際に4ルート6箇所で
 * そうなっていた）。到達しないコードと、それを踏ませるためだけの嘘の入力は、
 * 読む人に「この状態は起こり得る」と誤解させるので害がある。
 *
 * 判別可能合併にすれば `reason === 'ok'` を通過した時点で facilityId は string に確定し、
 * ガードもテストも不要になる（TypeScript 5 は分割代入した合併型もナローイングできる）。
 */
// ⚠️ 各メンバーの reason は【単一のリテラル】であること。
// `{ reason: Exclude<ResolveFacilityReason,'ok'>; facilityId: null }` のように合併リテラルで
// 1メンバーにまとめると、分割代入したあとの絞り込みが効かない（'none' を除外しても
// そのメンバーは 'forbidden' | 'ambiguous' として残るため facilityId が null 側から外れない）。
// 実際にその形で書いて tsc が通らないことを確認済み。
export type ResolvedTargetFacility =
  | { reason: 'ok'; facilityId: string }
  | { reason: 'forbidden'; facilityId: null }
  | { reason: 'ambiguous'; facilityId: null }
  | { reason: 'none'; facilityId: null };

/**
 * リクエストの facility_id 指定と所属集合を突合し、対象施設IDを決定する。
 * - 指定あり: 所属集合に含まれるかを検証（含まれなければ forbidden）
 * - 指定なし: 単一施設なら自動選択、複数施設なら ambiguous（要指定）
 * - 所属施設がゼロ: none
 */
export function resolveTargetFacilityId(
  facilityIds: string[],
  requestedFacilityId: unknown,
): ResolvedTargetFacility {
  if (facilityIds.length === 0) return { facilityId: null, reason: 'none' };
  if (typeof requestedFacilityId === 'string' && requestedFacilityId.length > 0) {
    if (!facilityIds.includes(requestedFacilityId)) return { facilityId: null, reason: 'forbidden' };
    return { facilityId: requestedFacilityId, reason: 'ok' };
  }
  if (facilityIds.length === 1) return { facilityId: facilityIds[0], reason: 'ok' };
  return { facilityId: null, reason: 'ambiguous' };
}
