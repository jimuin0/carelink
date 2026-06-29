/**
 * @jest-environment node
 *
 * Tests for POST /api/unsubscribe — both HMAC (方式B) and token (方式A) paths.
 * Key assertions: DB failures return 500 (GDPR — user must know unsubscribe failed).
 */

import { createHmac } from 'crypto';

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));

const mockFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom }),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}));

// Set up HMAC secret for tests
const TEST_SECRET = 'test-hmac-secret-32-chars-minimum!';
const TEST_EMAIL = 'user@example.com';
const VALID_TOKEN = 'a'.repeat(64); // 64-char hex-like string for token tests

function makeHmac(email: string): string {
  return createHmac('sha256', TEST_SECRET).update(email.toLowerCase()).digest('hex');
}

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { encryptUnsubEmail } from '@/lib/newsletter-unsub';

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

function makeRequest(body: object) {
  return new Request('http://localhost/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fluentChain(resolveWith: unknown) {
  const chain: Record<string, jest.Mock> = {};
  const link = jest.fn(() => chain);
  chain.select = link; chain.eq = link; chain.update = link;
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  chain.single = jest.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  return chain;
}

function updateChain(error: unknown = null) {
  const eq = jest.fn().mockReturnThis();
  return {
    update: jest.fn(() => ({ eq, then: jest.fn((fn: (v: unknown) => unknown) => Promise.resolve({ error }).then(fn)) })),
    select: jest.fn(() => ({ eq, maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
    eq,
  };
}

// ─── 方式B: HMAC ────────────────────────────────────────────────────────────

describe('HMAC path (方式B)', () => {
  test('有効なHMACで購読解除成功 → 200 success:true', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluentChain({ is_active: true }); // newsletter sub check
      // update calls — return no error
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.already).toBe(false);
  });

  test('不正なHMAC → 200 already:true (列挙攻撃防止)', async () => {
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: 'b'.repeat(64) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });

  test('既に購読解除済み → 200 already:true', async () => {
    mockFrom.mockImplementation(() => fluentChain({ is_active: false }));

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });

  test('newsletter_subscriptions UPDATE失敗 → 500 (GDPR: 失敗を隠さない)', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluentChain({ is_active: true }); // sub exists and active
      // Update fails
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(500);
  });

  test('レートリミット → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(429);
  });
});

// ─── 方式C: 暗号化トークン（メールを URL に露出しない） ───────────────────────

describe('Encrypted token path (方式C)', () => {
  test('有効な暗号化トークンで購読解除成功 → 200 success:true（メールはサーバで復号）', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluentChain({ is_active: true });
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });

    const res = await POST(makeRequest({ n: encryptUnsubEmail(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.already).toBe(false);
  });

  test('改ざん/不正な暗号化トークン → 200 already:true（復号失敗・列挙攻撃防止）', async () => {
    const res = await POST(makeRequest({ n: 'tampered-invalid-token' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });

  test('既に購読解除済み → 200 already:true', async () => {
    mockFrom.mockImplementation(() => fluentChain({ is_active: false }));
    const res = await POST(makeRequest({ n: encryptUnsubEmail(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });
});

// ─── 方式A: トークン ─────────────────────────────────────────────────────────

describe('Token path (方式A)', () => {
  test('有効なトークンで購読解除成功 → 200 success:true', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // token lookup
        const chain = fluentChain({ user_id: 'user-1', used_at: null });
        chain.single = jest.fn(() => Promise.resolve({ data: { user_id: 'user-1', used_at: null }, error: null }));
        return chain;
      }
      if (callNum === 2) {
        // profile check
        const chain = fluentChain({ email_unsubscribed: false });
        chain.single = jest.fn(() => Promise.resolve({ data: { email_unsubscribed: false }, error: null }));
        return chain;
      }
      // profile update + token mark-used
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });

    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.already).toBe(false);
  });

  test('存在しないトークン → 200 already:true (列挙攻撃防止)', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
    }));

    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });

  test('使用済みトークン → 200 already:true', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: { user_id: 'user-1', used_at: '2026-01-01T00:00:00Z' }, error: null })),
    }));

    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(true);
  });

  test('profile UPDATE失敗 → 500 (GDPR: 失敗を隠さない)', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
                 single: jest.fn(() => Promise.resolve({ data: { user_id: 'user-1', used_at: null }, error: null })) };
      }
      if (callNum === 2) {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
                 single: jest.fn(() => Promise.resolve({ data: { email_unsubscribed: false }, error: null })) };
      }
      // profile update fails
      return { update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) })),
               eq: jest.fn().mockReturnThis() };
    });

    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    expect(res.status).toBe(500);
  });

  test('不正なトークン形式 → 400', async () => {
    const res = await POST(makeRequest({ token: 'short' }));
    expect(res.status).toBe(400);
  });

  test('ボディがない → 400', async () => {
    const res = await POST(new Request('http://localhost/api/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'invalid json',
    }));
    expect(res.status).toBe(400);
  });

  test('CSRF check failed → returns CSRF error', async () => {
    const { checkCsrf } = require('@/lib/csrf');
    const csrfResp = new Response(JSON.stringify({ e: 'CSRF' }), { status: 403 });
    checkCsrf.mockReturnValueOnce(csrfResp);
    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    expect(res.status).toBe(403);
  });

  test('missing x-forwarded-for → uses "unknown"', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
    }));
    await POST(new Request('http://localhost/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: VALID_TOKEN }),
    }));
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('NEWSLETTER_UNSUBSCRIBE_SECRET 未設定 → verifyUnsubHmac は false → already:true', async () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: 'a'.repeat(64) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already).toBe(true);
  });

  test('HMAC でも profiles UPDATE 失敗 → ログのみで success', async () => {
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return fluentChain({ is_active: true });
      if (table === 'newsletter_subscriptions') {
        return {
          update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
          eq: jest.fn().mockReturnThis(),
        };
      }
      // profiles UPDATE fails
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'profile err' } })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('Token path: profile.email_unsubscribed=true → already:true and token marked used', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: { user_id: 'u1', used_at: null }, error: null })),
        };
      }
      if (callNum === 2) {
        return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: { email_unsubscribed: true }, error: null })),
        };
      }
      // token update
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });
    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    const json = await res.json();
    expect(json.already).toBe(true);
  });

  test('Token path: token-mark-used エラー → ログのみ 200', async () => {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: { user_id: 'u1', used_at: null }, error: null })),
        };
      }
      if (callNum === 2) {
        return {
          select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: { email_unsubscribed: false }, error: null })),
        };
      }
      if (callNum === 3) {
        // profile UPDATE success
        return {
          update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
          eq: jest.fn().mockReturnThis(),
        };
      }
      // token mark used fails
      return {
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'mark err' } })) })),
        eq: jest.fn().mockReturnThis(),
      };
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
