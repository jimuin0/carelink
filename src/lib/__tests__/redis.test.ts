/**
 * Redis ユーティリティのユニットテスト
 * Upstash 未設定時はインメモリフォールバックでテスト
 */

// Mock Upstash to test fallback path
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => null),
}));
jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: jest.fn(),
}));

// Reset env before import
const originalEnv = process.env;
beforeAll(() => {
  process.env = { ...originalEnv };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterAll(() => {
  process.env = originalEnv;
});

// Dynamic import to pick up env changes
let cacheGet: typeof import('../redis').cacheGet;
let cacheSet: typeof import('../redis').cacheSet;
let cacheDel: typeof import('../redis').cacheDel;
let cachedFetch: typeof import('../redis').cachedFetch;
let isRedisAvailable: typeof import('../redis').isRedisAvailable;

beforeAll(async () => {
  const redis = await import('../redis');
  cacheGet = redis.cacheGet;
  cacheSet = redis.cacheSet;
  cacheDel = redis.cacheDel;
  cachedFetch = redis.cachedFetch;
  isRedisAvailable = redis.isRedisAvailable;
});

describe('Redis fallback (no Upstash)', () => {
  test('isRedisAvailable returns false without env vars', () => {
    expect(isRedisAvailable()).toBe(false);
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
    // TTL=0 means "expires in 0 seconds" — effectively immediate
    // Small delay to ensure expiry check
    await new Promise((r) => setTimeout(r, 10));
    const val = await cacheGet('test:key3');
    expect(val).toBeNull();
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
    expect(callCount).toBe(1); // fetcher called only once
  });

  test('cacheSet handles various value types', async () => {
    const testCases = [
      ['string:1', 'hello'],
      ['number:1', 42],
      ['array:1', [1, 2, 3]],
      ['null-val:1', null],
    ] as const;

    for (const [key, value] of testCases) {
      await cacheSet(key, value, 60);
      // Note: null values stored as null will be returned as null by cacheGet anyway
      if (value !== null) {
        const retrieved = await cacheGet(key);
        expect(retrieved).toEqual(value);
      }
    }
  });
});
