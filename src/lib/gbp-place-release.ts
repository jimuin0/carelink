/**
 * 保存済みの Place ID が施設の登録内容と合わなくなったとき、その Place ID ごと外す（2026年10月23日 新設）。
 *
 * 🔴 【なぜ評価を消すだけでは足りないか】以前は照合が外れても google_rating / google_review_count を消すだけで、
 * gbp_place_id と gbp_cid は残していた。その結果、
 *   - 店舗ページの「地図を見る」「Googleで口コミを書く」が他店を指し続け、
 *   - 一意索引 uq_facility_profiles_gbp_place_id がその ID を占有したままになり、本物の店舗が後から
 *     CareLink に載って自分の Place ID を登録しようとすると「別の店舗に登録されています」(409) で弾かれた。
 * Place ID・CID・連携日時・評価・診断結果をまとめて外し、保存（照合つき）からやり直してもらう。
 *
 * 【競合】照合に使った Place ID のままのときだけ外す（`.eq('gbp_place_id', placeId)`）。照合の最中に
 * オーナーが別の（照合を通った）ID を保存していたら、それを消さない（'changed' を返す）。
 *
 * 呼び出し元は service role のクライアントを渡す（管理画面の GET は所属確認の後、週次 cron はそのまま）。
 * DB 側でも同じ後始末をトリガ（20261023150200）が行うが、migration の適用前後どちらでも同じ結果になるよう、
 * ここでも評価と診断結果を明示的に消す。
 */
import type { createServiceRoleClient } from './supabase-server';

export type GbpPlaceReleaseResult = 'released' | 'changed' | 'failed';

export async function releaseMismatchedGbpPlace(
  db: ReturnType<typeof createServiceRoleClient>,
  facilityId: string,
  placeId: string,
): Promise<GbpPlaceReleaseResult> {
  const { data, error } = await db
    .from('facility_profiles')
    .update({ gbp_place_id: null, gbp_cid: null, gbp_connected_at: null, google_rating: null, google_review_count: 0 })
    .eq('id', facilityId)
    .eq('gbp_place_id', placeId)
    .select('id');
  if (error) return 'failed';
  if (!data || data.length === 0) return 'changed';
  // 診断結果（他店の店舗情報・クチコミ）も残さない。
  const { error: cacheError } = await db.from('gbp_audit_cache').delete().eq('facility_id', facilityId);
  return cacheError ? 'failed' : 'released';
}
