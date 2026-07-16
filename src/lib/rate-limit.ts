/**
 * Rate limit ライブラリ（Phase 6: Supabase Postgres 移行版）
 *
 * 2026-04 Upstash インスタンス消失 → 全 mutation API 500 事故の構造的再発防止として
 * Upstash 依存を完全廃止し、既存 Supabase Postgres の RPC check_rate_limit() に切替。
 *
 * 動作:
 *  1. checkRateLimit: Supabase RPC を最優先で試行（atomic INCR + ウィンドウ判定）
 *  2. Supabase 失敗時: in-memory フォールバック（fail-safe、本体 API は 500 化させない）
 *  3. inMemoryRateLimit: ルートが直接呼ぶ場合用（GET 系の軽量制限など）
 *
 * 既存呼び出しシグネチャ互換:
 *  - bookingRateLimit / mutationRateLimit を「設定オブジェクト」として export
 *  - checkRateLimit(config, ip, fallbackLimit, fallbackWindowMs, prefix) — config は記録用のみ
 */

import { createServiceRoleClient } from './supabase-server';

export interface RateLimitConfig {
  prefix: string;
  limit: number;
  windowMs: number;
}

// 用途別 config（既存 API シグネチャ互換のために null 許容）
export const bookingRateLimit: RateLimitConfig | null = {
  prefix: 'rl:booking',
  limit: 3,
  windowMs: 5 * 60_000,
};

export const mutationRateLimit: RateLimitConfig | null = {
  prefix: 'rl:mutation',
  limit: 10,
  windowMs: 60_000,
};

// ===== in-memory fallback =====
// Supabase RPC が失敗した場合 + 単独で inMemoryRateLimit を呼ぶルート用

const store = new Map<string, number[]>();

export function inMemoryRateLimit(
  ip: string,
  limit: number,
  windowMs: number,
  prefix: string
): boolean {
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const timestamps = (store.get(key) || []).filter((t) => now - t < windowMs);
  const limited = timestamps.length >= limit;
  if (!limited) timestamps.push(now);
  // LRU: 常に delete+set でアクセス順を末尾に更新
  store.delete(key);
  store.set(key, timestamps);
  // 定期的に expired entry を掃除（メモリリーク防止）
  if (store.size > 500) {
    Array.from(store.entries()).forEach(([k, ts]) => {
      if (ts.every((t: number) => now - t >= windowMs)) store.delete(k);
    });
    if (store.size > 1000) {
      const entries = Array.from(store.keys());
      entries.slice(0, entries.length - 500).forEach((k) => store.delete(k));
    }
  }
  return limited;
}

/**
 * テスト/観測用: in-memory フォールバックストアの現在エントリ数を返す。
 * LRU eviction・hard cap(1000)が実際に機能しているかを検証可能にする（監査T5）。
 */
export function inMemoryStoreSize(): number {
  return store.size;
}

// ===== Supabase RPC ベース =====

export async function checkRateLimit(
  // 第1引数 config は記録用のみ（実装では fallbackLimit/fallbackWindowMs/prefix が真の値）
  _config: RateLimitConfig | null,
  ip: string,
  fallbackLimit: number,
  fallbackWindowMs: number,
  prefix: string
): Promise<boolean> {
  const key = `${prefix}:${ip}`;
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_limit: fallbackLimit,
      p_window_ms: fallbackWindowMs,
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    // Supabase RPC が落ちている / 未マイグレ / 接続失敗等の場合、
    // 例外を伝播させると API ルート全体が 500 になるため
    // in-memory フォールバックに切り替える（fail-safe）
    console.error(
      `[rate-limit] Supabase RPC failure, falling back to in-memory:`,
      e instanceof Error ? e.message : String(e)
    );
    return inMemoryRateLimit(ip, fallbackLimit, fallbackWindowMs, prefix);
  }
}
