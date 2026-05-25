/**
 * キャッシュ / セッション ユーティリティ（Phase 6: Upstash 廃止版）
 *
 * 旧版は @upstash/redis を依存先としていたが、Phase 6 で Upstash ベンダーを
 * 完全廃止したため、現在は MemoryStore（プロセス内 in-memory）のみで動作する。
 *
 * 影響:
 *  - cachedFetch: 各 serverless インスタンスが独自キャッシュを持つ
 *    （cache miss が増えるが機能的には等価、追加 DB クエリ 1 回/instance）
 *  - queuePush/queuePop/queueLength: 本番未使用（grep で 0 件確認済）
 *  - sessionSet/sessionGet/sessionDel: 本番未使用（同上）
 *
 * 将来クロスインスタンス共有キャッシュが必要になった場合は
 * Supabase に cache_buckets テーブルを追加して同パターンで切り替え可能。
 */

// ===== In-memory store =====

class MemoryStore {
  private store = new Map<string, { value: unknown; expires: number | null }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires != null && entry.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expires: ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.get<unknown>(key);
    return val !== null;
  }
}

const memStore = new MemoryStore();

// ===== Cache API =====

export async function cacheGet<T>(key: string): Promise<T | null> {
  return memStore.get<T>(key);
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  await memStore.set(key, value, ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await memStore.del(key);
}

export async function cacheExists(key: string): Promise<boolean> {
  return memStore.exists(key);
}

/**
 * キャッシュ or Fetch パターン
 * @param key キャッシュキー
 * @param fetcher データ取得関数
 * @param ttlSeconds TTL（秒、既定 300）
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 300
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

// ===== Queue API（互換のため残置、in-memory では no-op） =====

export async function queuePush(_queueName: string, _job: unknown): Promise<void> {
  // in-memory では実装なし（本番未使用）
}

export async function queuePop<T>(_queueName: string): Promise<T | null> {
  return null;
}

export async function queueLength(_queueName: string): Promise<number> {
  return 0;
}

// ===== Session API（cacheGet/Set ラッパー） =====

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export async function sessionSet(sessionId: string, data: unknown): Promise<void> {
  await cacheSet(`session:${sessionId}`, data, SESSION_TTL);
}

export async function sessionGet<T>(sessionId: string): Promise<T | null> {
  return cacheGet<T>(`session:${sessionId}`);
}

export async function sessionDel(sessionId: string): Promise<void> {
  await cacheDel(`session:${sessionId}`);
}

// ===== Compat =====

/**
 * @deprecated Phase 6 で Upstash 廃止。常に false を返す。
 */
export function isRedisAvailable(): boolean {
  return false;
}

/**
 * @deprecated Phase 6 で Upstash 廃止。常に null。
 */
export const redisClient = null;
