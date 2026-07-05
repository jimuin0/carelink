/**
 * 人気施設（履歴なしユーザー向けレコメンド）のキャッシュ（監査P1）。
 *
 * 背景: /api/recommendations は履歴なしユーザーに facility_card_view（集計VIEW）を
 * リクエスト毎に叩き直していた。この結果はユーザー非依存（limit のみに依存）なのに
 * キャッシュが無く、アクセス増加時にVIEW実体化コストが線形に増える。
 *
 * feature-flags.ts と同じ「process メモリ + TTL」パターンを踏襲する
 * （Next.js の unstable_cache は Jest 環境で動作せずテスト不能だったため不採用）。
 * limit(1〜12) ごとに別キーでキャッシュする。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface CacheEntry {
  data: unknown[];
  cachedAt: number;
}

const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 人気施設（rating_count 降順・published限定）を limit 件取得する。
 * TTL内はDBを叩かずキャッシュを返す。
 */
export async function getPopularFacilitiesCached(
  admin: SupabaseClient,
  limit: number,
): Promise<unknown[]> {
  const now = Date.now();
  const cached = cache.get(limit);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const { data } = await admin
    .from('facility_card_view')
    .select('*')
    .eq('status', 'published')
    .order('rating_count', { ascending: false })
    .limit(limit);

  const result = data ?? [];
  cache.set(limit, { data: result, cachedAt: now });
  return result;
}

/** キャッシュを強制クリア（テスト用・将来の手動invalidation用）。 */
export function clearPopularFacilitiesCache(): void {
  cache.clear();
}
