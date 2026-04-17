/**
 * Feature Flag ヘルパー（v8.41）
 * 機能の段階的リリース・緊急停止スイッチ
 *
 * Usage:
 *   // サーバーサイド
 *   import { isFeatureEnabled } from '@/lib/feature-flags';
 *   if (await isFeatureEnabled('stripe_checkout')) { ... }
 *
 *   // ユーザー別ロールアウト
 *   if (await isFeatureEnabled('new_booking_ui', userId)) { ... }
 */

import { createServerSupabaseClient } from './supabase-server';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  metadata: Record<string, unknown>;
}

/** フラグキャッシュ（process メモリ、5分TTL） */
const flagCache: { flags: Map<string, FeatureFlag>; loadedAt: number } = {
  flags: new Map(),
  loadedAt: 0,
};
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadFlags(): Promise<Map<string, FeatureFlag>> {
  const now = Date.now();
  if (flagCache.flags.size > 0 && now - flagCache.loadedAt < CACHE_TTL_MS) {
    return flagCache.flags;
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('feature_flags').select('key, enabled, rollout_pct, description, metadata');
    if (data) {
      const newMap = new Map<string, FeatureFlag>();
      for (const row of data) {
        newMap.set(row.key, row as FeatureFlag);
      }
      flagCache.flags = newMap;
      flagCache.loadedAt = now;
    }
  } catch {
    // DBエラー時はキャッシュを使い続ける
  }

  return flagCache.flags;
}

/**
 * フラグが有効かどうかを判定する
 * @param key フラグキー
 * @param userId オプション: ユーザーID（ロールアウト割合の判定に使用）
 */
export async function isFeatureEnabled(key: string, userId?: string | null): Promise<boolean> {
  const flags = await loadFlags();
  const flag = flags.get(key);
  if (!flag) return false;
  if (!flag.enabled) return false;

  // ホワイトリスト確認（metadata.allowed_user_ids）
  const allowedIds = flag.metadata?.allowed_user_ids as string[] | undefined;
  if (allowedIds && userId && allowedIds.includes(userId)) return true;

  // ロールアウト割合が100%なら全員有効
  if (flag.rollout_pct >= 100) return true;
  if (flag.rollout_pct <= 0) return false;

  // ユーザーIDベースの決定的ハッシュ（A/Bテスト安定性）
  if (userId) {
    // 簡易ハッシュ: ユーザーID末尾2文字を16進数として0-99にマップ
    const hashByte = parseInt(userId.slice(-2), 16) % 100;
    return hashByte < flag.rollout_pct;
  }

  // ユーザー不明の場合はロールアウト割合をランダム判定
  return Math.random() * 100 < flag.rollout_pct;
}

/**
 * 複数フラグを一括取得（管理画面向け）
 */
export async function getAllFlags(): Promise<FeatureFlag[]> {
  const flags = await loadFlags();
  return Array.from(flags.values());
}

/** キャッシュを強制クリア（フラグ更新後に呼び出す） */
export function clearFlagCache(): void {
  flagCache.flags.clear();
  flagCache.loadedAt = 0;
}
