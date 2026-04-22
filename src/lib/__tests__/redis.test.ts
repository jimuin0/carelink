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
let cacheExists: typeof import('../redis').cacheExists;
let cachedFetch: typeof import('../redis').cachedFetch;
let isRedisAvailable: typeof import('../redis').isRedisAvailable;
let queuePush: typeof import('../redis').queuePush;
let queuePop: typeof import('../redis').queuePop;
let queueLength: typeof import('../redis').queueLength;
let sessionSet: typeof import('../redis').sessionSet;
let sessionGet: typeof import('../redis').sessionGet;
let sessionDel: typeof import('../redis').sessionDel;

beforeAll(async () => {
  const redis = await import('../redis');
  cacheGet = redis.cacheGet;
  cacheSet = redis.cacheSet;
  cacheDel = redis.cacheDel;
  cacheExists = redis.cacheExists;
  cachedFetch = redis.cachedFetch;
  isRedisAvailable = redis.isRedisAvailable;
  queuePush = redis.queuePush;
  queuePop = redis.queuePop;
  queueLength = redis.queueLength;
  sessionSet = redis.sessionSet;
  sessionGet = redis.sessionGet;
  sessionDel = redis.sessionDel;
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

  test('queuePush does not throw without Redis', async () => {
    await expect(queuePush('test-queue', { job: 'data' })).resolves.toBeUndefined();
  });

  test('queuePop returns null without Redis', async () => {
    expect(await queuePop('test-queue')).toBeNull();
  });

  test('queueLength returns 0 without Redis', async () => {
    expect(await queueLength('test-queue')).toBe(0);
  });

  test('sessionSet and sessionGet work with in-memory fallback', async () => {
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

// ─── Redis path (Upstash available) ───────────────────────────────────────────

describe('Redis path (Upstash configured)', () => {
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    exists: jest.Mock;
    lpush: jest.Mock;
    rpop: jest.Mock;
    llen: jest.Mock;
  };
  let redisMod: typeof import('../redis');

  beforeAll(async () => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn(),
      lpush: jest.fn().mockResolvedValue(1),
      rpop: jest.fn(),
      llen: jest.fn(),
    };

    jest.resetModules();
    jest.mock('@upstash/redis', () => ({
      Redis: jest.fn().mockImplementation(() => mockRedis),
    }));
    jest.mock('@upstash/ratelimit', () => ({ Ratelimit: jest.fn() }));

    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

    redisMod = await import('../redis');
  });

  afterAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.lpush.mockResolvedValue(1);
  });

  test('isRedisAvailable returns true', () => {
    expect(redisMod.isRedisAvailable()).toBe(true);
  });

  test('cacheGet delegates to redis.get', async () => {
    mockRedis.get.mockResolvedValue('cached-val');
    const result = await redisMod.cacheGet<string>('my-key');
    expect(mockRedis.get).toHaveBeenCalledWith('my-key');
    expect(result).toBe('cached-val');
  });

  test('cacheSet with TTL calls redis.set with ex option', async () => {
    await redisMod.cacheSet('my-key', 'value', 60);
    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'value', { ex: 60 });
  });

  test('cacheSet without TTL calls redis.set without options', async () => {
    await redisMod.cacheSet('my-key', 'value');
    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'value');
  });

  test('cacheDel delegates to redis.del', async () => {
    await redisMod.cacheDel('my-key');
    expect(mockRedis.del).toHaveBeenCalledWith('my-key');
  });

  test('cacheExists returns true when redis.exists > 0', async () => {
    mockRedis.exists.mockResolvedValue(1);
    expect(await redisMod.cacheExists('my-key')).toBe(true);
  });

  test('cacheExists returns false when redis.exists === 0', async () => {
    mockRedis.exists.mockResolvedValue(0);
    expect(await redisMod.cacheExists('my-key')).toBe(false);
  });

  test('queuePush calls redis.lpush with JSON', async () => {
    await redisMod.queuePush('q', { job: 'data' });
    expect(mockRedis.lpush).toHaveBeenCalledWith('q', JSON.stringify({ job: 'data' }));
  });

  test('queuePop returns parsed JSON from redis.rpop', async () => {
    mockRedis.rpop.mockResolvedValue(JSON.stringify({ job: 'data' }));
    const result = await redisMod.queuePop<{ job: string }>('q');
    expect(result).toEqual({ job: 'data' });
  });

  test('queuePop returns null when redis.rpop returns null', async () => {
    mockRedis.rpop.mockResolvedValue(null);
    expect(await redisMod.queuePop('q')).toBeNull();
  });

  test('queuePop returns null when JSON.parse fails', async () => {
    mockRedis.rpop.mockResolvedValue('invalid-json{');
    expect(await redisMod.queuePop('q')).toBeNull();
  });

  test('queueLength delegates to redis.llen', async () => {
    mockRedis.llen.mockResolvedValue(5);
    expect(await redisMod.queueLength('q')).toBe(5);
  });
});
