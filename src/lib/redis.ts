/**
 * Upstash Redis ユーティリティ
 * キャッシュ・キュー・セッションの共通インターフェース
 *
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定の場合は
 * インメモリフォールバックが動作する（開発環境・テスト用）
 */
import { Redis } from '@upstash/redis';

// ===== Redis client =====

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

const _redis = getRedis();

// ===== In-memory fallback =====

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

/**
 * キャッシュから値を取得
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (_redis) {
    return _redis.get<T>(key);
  }
  return memStore.get<T>(key);
}

/**
 * 値をキャッシュに保存
 * @param key キャッシュキー
 * @param value 保存する値
 * @param ttlSeconds TTL（秒）、未指定時は無期限
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (_redis) {
    if (ttlSeconds != null) {
      await _redis.set(key, value, { ex: ttlSeconds });
    } else {
      await _redis.set(key, value);
    }
    return;
  }
  await memStore.set(key, value, ttlSeconds);
}

/**
 * キャッシュを削除
 */
export async function cacheDel(key: string): Promise<void> {
  if (_redis) {
    await _redis.del(key);
    return;
  }
  await memStore.del(key);
}

/**
 * キャッシュが存在するか確認
 */
export async function cacheExists(key: string): Promise<boolean> {
  if (_redis) {
    const result = await _redis.exists(key);
    return result > 0;
  }
  return memStore.exists(key);
}

/**
 * キャッシュ or Fetch パターン
 * @param key キャッシュキー
 * @param fetcher データ取得関数
 * @param ttlSeconds TTL（秒）
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

// ===== Queue API (simple list-based) =====

/**
 * キューにジョブを追加
 */
export async function queuePush(queueName: string, job: unknown): Promise<void> {
  if (_redis) {
    await _redis.lpush(queueName, JSON.stringify(job));
    return;
  }
  // In-memory fallback: not for production use
}

/**
 * キューからジョブを取得（FIFO）
 */
export async function queuePop<T>(queueName: string): Promise<T | null> {
  if (_redis) {
    const item = await _redis.rpop<string>(queueName);
    if (!item) return null;
    try {
      return JSON.parse(item) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * キューの長さを取得
 */
export async function queueLength(queueName: string): Promise<number> {
  if (_redis) {
    return _redis.llen(queueName);
  }
  return 0;
}

// ===== Session API =====

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

/**
 * セッションを保存
 */
export async function sessionSet(sessionId: string, data: unknown): Promise<void> {
  await cacheSet(`session:${sessionId}`, data, SESSION_TTL);
}

/**
 * セッションを取得
 */
export async function sessionGet<T>(sessionId: string): Promise<T | null> {
  return cacheGet<T>(`session:${sessionId}`);
}

/**
 * セッションを削除
 */
export async function sessionDel(sessionId: string): Promise<void> {
  await cacheDel(`session:${sessionId}`);
}

// ===== Connection check =====

export function isRedisAvailable(): boolean {
  return _redis !== null;
}

export { _redis as redisClient };
