/**
 * @jest-environment node
 *
 * Tests for GET /api/health（多依存ヘルスチェック）
 * Key assertions:
 *   - 4 依存（supabase / upstash / stripe / resend）の並列 ping
 *   - critical（supabase + upstash）両方 OK → 200 healthy
 *   - critical のいずれか NG → 503 unhealthy
 *   - degraded（stripe / resend）NG のみ → 200 degraded
 *   - deps の各依存に { ok, elapsed_ms } を含む
 *   - response に elapsed_ms / timestamp / version を含む
 */

jest.mock('@/lib/supabase-server');
jest.mock('@upstash/redis');

import { GET } from '../route';

let mockSelect: jest.Mock;
let mockPing: jest.Mock;
let originalFetch: typeof fetch;

function setupDefaultMocks(opts: {
  supabaseOk?: boolean;
  upstashOk?: boolean;
  stripeOk?: boolean;
  resendOk?: boolean;
  supabaseThrows?: boolean;
} = {}) {
  const {
    supabaseOk = true,
    upstashOk = true,
    stripeOk = true,
    resendOk = true,
    supabaseThrows = false,
  } = opts;

  // Supabase mock
  mockSelect = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue({
      error: supabaseOk ? null : { message: 'Connection timeout' },
    }),
  });
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  if (supabaseThrows) {
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection failed');
    });
  } else {
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });
  }

  // Upstash mock
  mockPing = jest.fn().mockResolvedValue(upstashOk ? 'PONG' : 'UNEXPECTED');
  const { Redis } = require('@upstash/redis');
  Redis.mockImplementation(() => ({ ping: mockPing }));

  // Fetch mock for Stripe + Resend
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes('stripe.com')) {
      return new Response(JSON.stringify({}), { status: stripeOk ? 200 : 500 });
    }
    if (u.includes('resend.com')) {
      return new Response(null, { status: resendOk ? 200 : 401 });
    }
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;

  // env defaults
  process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.RESEND_API_KEY = 're_test_dummy';
}

beforeEach(() => {
  jest.clearAllMocks();
  originalFetch = global.fetch;
  setupDefaultMocks();
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('GET /api/health (multi-dep)', () => {
  test('全 critical OK + degraded OK → 200 healthy', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.deps.supabase.ok).toBe(true);
    expect(json.deps.upstash.ok).toBe(true);
    expect(json.deps.stripe.ok).toBe(true);
    expect(json.deps.resend.ok).toBe(true);
  });

  test('Supabase NG → 503 unhealthy', async () => {
    setupDefaultMocks({ supabaseOk: false });
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.deps.supabase.ok).toBe(false);
  });

  test('Upstash NG → 503 unhealthy', async () => {
    setupDefaultMocks({ upstashOk: false });
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.deps.upstash.ok).toBe(false);
  });

  test('Stripe NG のみ → 200 degraded (critical 維持)', async () => {
    setupDefaultMocks({ stripeOk: false });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.stripe.ok).toBe(false);
  });

  test('Resend NG のみ → 200 degraded', async () => {
    setupDefaultMocks({ resendOk: false });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.resend.ok).toBe(false);
  });

  test('Supabase exception → 503', async () => {
    setupDefaultMocks({ supabaseThrows: true });
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.deps.supabase.ok).toBe(false);
  });

  test('response includes elapsed_ms, timestamp, version', async () => {
    const res = await GET();
    const json = await res.json();
    expect(typeof json.elapsed_ms).toBe('number');
    expect(json.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(json.timestamp).toBeDefined();
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
    expect(json.version).toBeDefined();
  });

  test('version from VERCEL_GIT_COMMIT_SHA (first 7 chars)', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def456ghi789';
    const res = await GET();
    const json = await res.json();
    expect(json.version).toBe('abc123d');
  });

  test('version defaults to "local"', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.version).toBe('local');
  });

  test('each dep includes ok and elapsed_ms', async () => {
    const res = await GET();
    const json = await res.json();
    for (const k of ['supabase', 'upstash', 'stripe', 'resend']) {
      expect(typeof json.deps[k].ok).toBe('boolean');
      expect(typeof json.deps[k].elapsed_ms).toBe('number');
    }
  });

  test('failed dep includes error message', async () => {
    setupDefaultMocks({ upstashOk: false });
    const res = await GET();
    const json = await res.json();
    expect(json.deps.upstash.error).toBeDefined();
    expect(typeof json.deps.upstash.error).toBe('string');
  });

  test('Upstash 未設定 → upstash NG (not configured)', async () => {
    setupDefaultMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.deps.upstash.ok).toBe(false);
    expect(json.deps.upstash.error).toMatch(/not configured/);
  });

  test('Stripe 未設定 → stripe NG (not configured), degraded', async () => {
    setupDefaultMocks();
    delete process.env.STRIPE_SECRET_KEY;
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.stripe.ok).toBe(false);
  });

  test('Resend 401 → resend NG', async () => {
    setupDefaultMocks({ resendOk: false });
    const res = await GET();
    const json = await res.json();
    expect(json.deps.resend.ok).toBe(false);
    expect(json.deps.resend.error).toBeDefined();
  });

  test('queries facility_profiles with COUNT head:true', async () => {
    await GET();
    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  test('elapsed_ms is reasonable (< 5 seconds)', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.elapsed_ms).toBeLessThan(5000);
  });

  test('response is valid JSON', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
  });

  test('no request parameters needed', async () => {
    const res = await GET();
    expect(res).toBeDefined();
  });
});
