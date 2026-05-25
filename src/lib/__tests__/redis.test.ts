/**
 * キャッシュユーティリティのユニットテスト（Phase 6: Upstash 廃止版）
 *
 * Phase 6 で @upstash/* 依存を完全廃止したため、redis.ts は MemoryStore 専用。
 * Upstash 分岐テストは削除し、in-memory 経路のみを検証する。
 */

import {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheExists,
  cachedFetch,
  isRedisAvailable,
  queuePush,
  queuePop,
  queueLength,
  sessionSet,
  sessionGet,
  sessionDel,
  redisClient,
} from '../redis';

describe('Cache API (in-memory only)', () => {
  test('isRedisAvailable は常に false を返す（Phase 6 で Upstash 廃止）', () => {
    expect(isRedisAvailable()).toBe(false);
  });

  test('redisClient は常に null（Phase 6 互換性のため残置）', () => {
    expect(redisClient).toBeNull();
  });

  test('cacheGet returns null for missing key', async () => {
    const val = await cacheGet('nonexistent:key:xyz');
    expect(val).toBeNull();
  });

  test('cacheSet and cacheGet work', async () => {
    await cacheSet('test:key1', { hello: 'world' }, 60);
    const val = await cacheGet<{ hello: string }>('test:key1');
    expect(val).toEqual({ hello: 'world' });
  });

  test('cacheDel removes key', async () => {
    await cacheSet('test:key2', 'to-be-deleted', 60);
    await cacheDel('test:key2');
    const val = await cacheGet('test:key2');
    expect(val).toBeNull();
  });

  test('cacheSet with 0 TTL expires immediately', async () => {
    await cacheSet('test:key3', 'expires-immediately', 0);
    await new Promise((r) => setTimeout(r, 10));
    const val = await cacheGet('test:key3');
    expect(val).toBeNull();
  });

  test('cacheSet without TTL は無期限保存', async () => {
    await cacheSet('test:key-noexp', 'persistent');
    const val = await cacheGet('test:key-noexp');
    expect(val).toBe('persistent');
  });

  test('cachedFetch returns cached value on second call', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { data: 'expensive result' };
    };

    const result1 = await cachedFetch('test:cached:1', fetcher, 60);
    const result2 = await cachedFetch('test:cached:1', fetcher, 60);

    expect(result1).toEqual({ data: 'expensive result' });
    expect(result2).toEqual({ data: 'expensive result' });
    expect(callCount).toBe(1);
  });

  test('cacheSet handles various value types', async () => {
    const testCases = [
      ['string:1', 'hello'],
      ['number:1', 42],
      ['array:1', [1, 2, 3]],
      ['object:1', { a: 1, b: 'two' }],
      ['bool:1', true],
    ] as const;

    for (const [key, value] of testCases) {
      await cacheSet(key, value, 60);
      const retrieved = await cacheGet(key);
      expect(retrieved).toEqual(value);
    }
  });

  test('cacheExists returns false for missing key', async () => {
    expect(await cacheExists('nonexistent:exists:test')).toBe(false);
  });

  test('cacheExists returns true for existing key', async () => {
    await cacheSet('exists:test:key', 'value', 60);
    expect(await cacheExists('exists:test:key')).toBe(true);
  });

  test('cacheExists returns false after deletion', async () => {
    await cacheSet('exists:del:key', 'value', 60);
    await cacheDel('exists:del:key');
    expect(await cacheExists('exists:del:key')).toBe(false);
  });
});

describe('Queue API (Phase 6: in-memory では no-op)', () => {
  test('queuePush は throw しない', async () => {
    await expect(queuePush('test-queue', { job: 'data' })).resolves.toBeUndefined();
  });

  test('queuePop は常に null を返す', async () => {
    expect(await queuePop('test-queue')).toBeNull();
  });

  test('queueLength は常に 0 を返す', async () => {
    expect(await queueLength('test-queue')).toBe(0);
  });
});

describe('Session API (cacheGet/Set ラッパー)', () => {
  test('sessionSet and sessionGet work with in-memory store', async () => {
    await sessionSet('sess-123', { userId: 'user-abc', role: 'admin' });
    const data = await sessionGet<{ userId: string; role: string }>('sess-123');
    expect(data).toEqual({ userId: 'user-abc', role: 'admin' });
  });

  test('sessionGet returns null for unknown session', async () => {
    const data = await sessionGet('nonexistent-session');
    expect(data).toBeNull();
  });

  test('sessionDel removes session', async () => {
    await sessionSet('sess-del', { userId: 'user-del' });
    await sessionDel('sess-del');
    const data = await sessionGet('sess-del');
    expect(data).toBeNull();
  });
});
