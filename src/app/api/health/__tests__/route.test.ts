/**
 * @jest-environment node
 *
 * Tests for GET /api/health（Phase 6: rate_limit RPC ベースに更新）
 * Key assertions:
 *   - 4 依存（supabase / rate_limit / stripe / resend）の並列 ping
 *   - critical（supabase + rate_limit）両方 OK → 200 healthy
 *   - critical のいずれか NG → 503 unhealthy
 *   - degraded（stripe / resend）NG のみ → 200 degraded
 *   - deps の各依存に { ok, elapsed_ms } を含む
 *   - response に elapsed_ms / timestamp / version を含む
 */

jest.mock('@/lib/supabase-server');
jest.mock('@/lib/rate-limit');

import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

// 監視・各テストは IP 付きの Request を渡す（GET は getClientIp(request) を呼ぶ）
function makeReq(): Request {
  return new Request('http://localhost/api/health', { headers: { 'x-real-ip': '127.0.0.1' } });
}

let mockSelect: jest.Mock;
let mockRpc: jest.Mock;
let originalFetch: typeof fetch;

function setupDefaultMocks(opts: {
  supabaseOk?: boolean;
  rateLimitOk?: boolean;
  stripeOk?: boolean;
  resendOk?: boolean;
  supabaseThrows?: boolean;
  cron?: 'fresh' | 'stale' | 'error' | 'nodata';
} = {}) {
  const {
    supabaseOk = true,
    rateLimitOk = true,
    stripeOk = true,
    resendOk = true,
    supabaseThrows = false,
    cron = 'fresh',
  } = opts;

  // Supabase mock（DB read 用 + RPC 用の両方）
  mockSelect = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue({
      error: supabaseOk ? null : { message: 'Connection timeout' },
    }),
  });
  mockRpc = jest.fn().mockResolvedValue({
    data: false,
    error: rateLimitOk ? null : { message: 'RPC failed' },
  });
  const { createServerSupabaseClient, createServiceRoleClient } = require('@/lib/supabase-server');
  if (supabaseThrows) {
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection failed');
    });
  } else {
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });
  }
  // cron 鮮度 probe 用: createServiceRoleClient().from('cron_logs').select().order().limit().maybeSingle()
  const cronResult =
    cron === 'error'
      ? { data: null, error: { message: 'cron query boom' } }
      : cron === 'nodata'
        ? { data: null, error: null }
        : cron === 'stale'
          ? { data: { started_at: new Date(Date.now() - 120 * 60_000).toISOString() }, error: null }
          : { data: { started_at: new Date(Date.now() - 1 * 60_000).toISOString() }, error: null };
  const cronChain: Record<string, unknown> = {
    select: () => cronChain,
    eq: () => cronChain,
    order: () => cronChain,
    limit: () => cronChain,
    maybeSingle: () => Promise.resolve(cronResult),
  };
  createServiceRoleClient.mockReturnValue({
    rpc: mockRpc,
    from: jest.fn().mockReturnValue(cronChain),
  });

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
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.RESEND_API_KEY = 're_test_dummy';
}

beforeEach(() => {
  jest.clearAllMocks();
  originalFetch = global.fetch;
  setupDefaultMocks();
  mockCheckRateLimit.mockResolvedValue(false); // 既定はレート制限に掛からない
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('GET /api/health (multi-dep, Supabase-based rate_limit)', () => {
  test('全 critical OK + degraded OK → 200 healthy', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.deps.supabase.ok).toBe(true);
    expect(json.deps.rate_limit.ok).toBe(true);
    expect(json.deps.stripe.ok).toBe(true);
    expect(json.deps.resend.ok).toBe(true);
    expect(json.deps.cron.ok).toBe(true);
  });

  test('cron が stale（60分超どの cron も未実行）→ 200 degraded・deps.cron NG', async () => {
    setupDefaultMocks({ cron: 'stale' });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.cron.ok).toBe(false);
    expect(json.deps.cron.error).toMatch(/stale/);
  });

  test('cron_logs 取得エラー → 200 degraded・deps.cron NG', async () => {
    setupDefaultMocks({ cron: 'error' });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.cron.ok).toBe(false);
  });

  test('cron-heartbeat 実行履歴なし → 200 degraded・deps.cron NG', async () => {
    setupDefaultMocks({ cron: 'nodata' });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.cron.ok).toBe(false);
    expect(json.deps.cron.error).toMatch(/never run/);
  });

  test('cron stale でも critical OK なら 503 にはしない（サイト停止扱いにしない）', async () => {
    setupDefaultMocks({ cron: 'stale' });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  test('Supabase NG → 503 unhealthy', async () => {
    setupDefaultMocks({ supabaseOk: false });
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.deps.supabase.ok).toBe(false);
  });

  test('rate_limit RPC NG → 503 unhealthy', async () => {
    setupDefaultMocks({ rateLimitOk: false });
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.deps.rate_limit.ok).toBe(false);
  });

  test('Supabase 初回失敗→即再試行成功 → 200（一過性スパイク吸収・retried フラグ）', async () => {
    // critical probe は失敗時に1回だけ再試行する。初回失敗・2回目成功なら 503 にならない。
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const limitMock = jest.fn()
      .mockResolvedValueOnce({ error: { message: 'transient timeout' } }) // 1回目: 一過性失敗
      .mockResolvedValueOnce({ error: null });                            // 2回目: 回復
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ limit: limitMock }) }),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deps.supabase.ok).toBe(true);
    expect(json.deps.supabase.retried).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  test('Supabase 2回とも失敗 → 503（持続的な実停止のみ unhealthy）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const limitMock = jest.fn().mockResolvedValue({ error: { message: 'sustained outage' } });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ limit: limitMock }) }),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.deps.supabase.ok).toBe(false);
    expect(json.deps.supabase.retried).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  test('Stripe NG のみ → 200 degraded (critical 維持)', async () => {
    setupDefaultMocks({ stripeOk: false });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.stripe.ok).toBe(false);
  });

  test('Resend NG のみ → 200 degraded', async () => {
    setupDefaultMocks({ resendOk: false });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.resend.ok).toBe(false);
  });

  test('Supabase exception → 503', async () => {
    setupDefaultMocks({ supabaseThrows: true });
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.deps.supabase.ok).toBe(false);
  });

  test('response includes elapsed_ms, timestamp, version', async () => {
    const res = await GET(makeReq());
    const json = await res.json();
    expect(typeof json.elapsed_ms).toBe('number');
    expect(json.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(json.timestamp).toBeDefined();
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
    expect(json.version).toBeDefined();
  });

  test('version from VERCEL_GIT_COMMIT_SHA (first 7 chars)', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def456ghi789';
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.version).toBe('abc123d');
  });

  test('version defaults to "local"', async () => {
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.version).toBe('local');
  });

  test('each dep includes ok and elapsed_ms', async () => {
    const res = await GET(makeReq());
    const json = await res.json();
    for (const k of ['supabase', 'rate_limit', 'stripe', 'resend', 'cron']) {
      expect(typeof json.deps[k].ok).toBe('boolean');
      expect(typeof json.deps[k].elapsed_ms).toBe('number');
    }
  });

  test('failed dep includes error message', async () => {
    setupDefaultMocks({ rateLimitOk: false });
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.rate_limit.error).toBeDefined();
    expect(typeof json.deps.rate_limit.error).toBe('string');
  });

  test('Stripe 未設定 → stripe NG (not configured), degraded', async () => {
    setupDefaultMocks();
    delete process.env.STRIPE_SECRET_KEY;
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.deps.stripe.ok).toBe(false);
  });

  test('Resend 401 → resend NG', async () => {
    setupDefaultMocks({ resendOk: false });
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.resend.ok).toBe(false);
    expect(json.deps.resend.error).toBeDefined();
  });

  test('queries facility_profiles with COUNT head:true', async () => {
    await GET(makeReq());
    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  test('rate_limit probe calls check_rate_limit RPC', async () => {
    await GET(makeReq());
    expect(mockRpc).toHaveBeenCalledWith('check_rate_limit', expect.objectContaining({
      p_key: expect.stringContaining('rl:health-probe'),
      p_limit: expect.any(Number),
      p_window_ms: expect.any(Number),
    }));
  });

  test('elapsed_ms is reasonable (< 5 seconds)', async () => {
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.elapsed_ms).toBeLessThan(5000);
  });

  test('response is valid JSON', async () => {
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
  });

  test('no request parameters needed', async () => {
    const res = await GET(makeReq());
    expect(res).toBeDefined();
  });

  test('Resend 500+ → resend NG (HTTP error branch)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.RESEND_API_KEY = 're_test_dummy';
    const { createServerSupabaseClient, createServiceRoleClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ error: null }) }),
      }),
    });
    createServiceRoleClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    });
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('stripe.com')) return new Response('{}', { status: 200 });
      if (u.includes('resend.com')) return new Response(null, { status: 503 });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.resend.ok).toBe(false);
    expect(json.deps.resend.error).toContain('HTTP 503');
  });

  test('Resend 404 → resend OK (key valid even if 404)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.RESEND_API_KEY = 're_test_dummy';
    const { createServerSupabaseClient, createServiceRoleClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ error: null }) }),
      }),
    });
    createServiceRoleClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    });
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('stripe.com')) return new Response('{}', { status: 200 });
      if (u.includes('resend.com')) return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.resend.ok).toBe(true);
  });

  test('Resend 未設定 → resend NG (not configured)', async () => {
    setupDefaultMocks();
    delete process.env.RESEND_API_KEY;
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.resend.ok).toBe(false);
  });

  test('レート制限超過 → 429（依存 probe を起動しない＝増幅 DoS 防止）', async () => {
    mockCheckRateLimit.mockResolvedValue(true);
    const res = await GET(makeReq());
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('Too Many Requests');
    // 依存プローブ（Supabase/Stripe/Resend）が一切呼ばれていないこと
    expect(mockSelect).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('non-Error thrown in probe → String(e) used', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.RESEND_API_KEY = 're_test_dummy';
    const { createServerSupabaseClient, createServiceRoleClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      // throw a non-Error value
      throw 'string-error';
    });
    createServiceRoleClient.mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: false, error: null }),
    });
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.deps.supabase.ok).toBe(false);
    expect(json.deps.supabase.error).toBe('string-error');
  });
});
