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
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

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

/**
 * 方式B/C（email 経路）の unsubscribeByEmail 用モック。table 名ごとの呼び出し回数で分岐する。
 * 呼び出し順（コード）:
 *   1. profiles.select('id').eq.maybeSingle           → linkedUserId(D-4)
 *   2. newsletter_subscriptions.select.eq.maybeSingle → sub（already 判定）
 *   3. newsletter_subscriptions.upsert(row,onConflict) → 原子的書き込み(D-3)
 *   3b(fallback:UNIQUE未適用のみ). newsletter_subscriptions.update.eq / .insert
 *   4. profiles.update.eq                             → email_unsubscribed
 */
function buildEmailMock(opts: {
  profileId?: string | null;
  sub?: { id: string; is_active: boolean } | null;
  upsertError?: unknown;               // null=成功 / {code:'42P10'}=フォールバック / その他=500
  updateError?: unknown;               // フォールバック update の error
  insertError?: unknown;               // フォールバック insert の error
  profileUpdateError?: unknown;
  upsertMock?: jest.Mock;
  insertMock?: jest.Mock;
} = {}) {
  const counts: Record<string, number> = {};
  return (table: string) => {
    counts[table] = (counts[table] || 0) + 1;
    const n = counts[table];
    if (table === 'profiles') {
      if (n === 1) {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.profileId != null ? { id: opts.profileId } : null, error: null }) }) }) };
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: opts.profileUpdateError ?? null }) }) };
    }
    if (table === 'newsletter_subscriptions') {
      if (n === 1) {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.sub ?? null, error: null }) }) }) };
      }
      if (n === 2) {
        return { upsert: opts.upsertMock ?? jest.fn(() => Promise.resolve({ error: opts.upsertError ?? null })) };
      }
      return {
        update: () => ({ eq: () => Promise.resolve({ error: opts.updateError ?? null }) }),
        insert: opts.insertMock ?? jest.fn(() => Promise.resolve({ error: opts.insertError ?? null })),
      };
    }
    return {};
  };
}

// ─── 方式B: HMAC ────────────────────────────────────────────────────────────

describe('HMAC path (方式B)', () => {
  test('有効なHMACで購読解除成功（upsert 原子書き込み・user_id 紐付け）→ 200 success:true', async () => {
    const upsertMock = jest.fn(() => Promise.resolve({ error: null }));
    mockFrom.mockImplementation(buildEmailMock({ profileId: 'user-9', sub: null, upsertMock }));

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.already).toBe(false);
    // D-4: profiles から取得した user_id を停止行に紐付ける。D-3: onConflict=email で原子的に書く。
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: TEST_EMAIL.toLowerCase(), is_active: false, source: 'unsubscribe', user_id: 'user-9' }),
      { onConflict: 'email' },
    );
  });

  test('upsert が UNIQUE 以外の DB エラー → 500（GDPR: 失敗を隠さない・D-3）', async () => {
    mockFrom.mockImplementation(buildEmailMock({ sub: null, upsertError: { code: '23505', message: 'other db error' } }));
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(500);
  });

  test('upsert エラーに message が無い(code も 42P10 以外) → 500（message ?? "" フォールバック）', async () => {
    mockFrom.mockImplementation(buildEmailMock({ sub: null, upsertError: { code: '23505' } }));
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(500);
  });

  test('upsert が 42P10(UNIQUE未適用) → フォールバック update 成功 → 200', async () => {
    mockFrom.mockImplementation(buildEmailMock({
      sub: { id: 'sub-1', is_active: true },
      upsertError: { code: '42P10', message: 'no unique or exclusion constraint matching' },
      updateError: null,
    }));
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
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

  test('フォールバック(42P10) の update 失敗 → 500 (GDPR: 失敗を隠さない)', async () => {
    mockFrom.mockImplementation(buildEmailMock({
      sub: { id: 'sub-1', is_active: true },
      upsertError: { code: '42P10', message: 'no unique or exclusion constraint' },
      updateError: { message: 'DB error' },
    }));
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(500);
  });

  test('レートリミット → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(429);
  });

  // B-6 根治: 購読レコードが無いアドレス（例: facility_members 経由のみで宛先化される
  // owner_monthly オーナー）でも、以後の判定に使える停止レコードが insert で作られる。
  test('購読レコードが無いアドレス → フォールバック(42P10) で停止行を insert して 200', async () => {
    const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
    mockFrom.mockImplementation(buildEmailMock({
      sub: null, // 購読レコード無し
      upsertError: { code: '42P10', message: 'no unique or exclusion constraint' },
      insertMock: mockInsert,
    }));

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.already).toBe(false);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: TEST_EMAIL.toLowerCase(), is_active: false, source: 'unsubscribe' }),
    );
  });

  test('購読レコードが無いアドレス → フォールバック insert 失敗 → 500 (GDPR: 失敗を隠さない)', async () => {
    mockFrom.mockImplementation(buildEmailMock({
      sub: null,
      upsertError: { code: '42P10', message: 'no unique or exclusion constraint' },
      insertError: { message: 'DB error' },
    }));

    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(500);
  });

  test('upsert エラーが code 無し・message で UNIQUE 不在を示す → フォールバック（D-3 regex 判定）', async () => {
    const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
    mockFrom.mockImplementation(buildEmailMock({
      sub: null,
      upsertError: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' },
      insertMock: mockInsert,
    }));
    const res = await POST(makeRequest({ email: TEST_EMAIL, hmac: makeHmac(TEST_EMAIL) }));
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
  });
});

// ─── 方式C: 暗号化トークン（メールを URL に露出しない） ───────────────────────

describe('Encrypted token path (方式C)', () => {
  test('有効な暗号化トークンで購読解除成功 → 200 success:true（メールはサーバで復号）', async () => {
    mockFrom.mockImplementation(buildEmailMock({ sub: null, upsertError: null }));

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
    mockFrom.mockImplementation(buildEmailMock({ sub: null, upsertError: null, profileUpdateError: { message: 'profile err' } }));
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

  test('ハンドラ内で例外 → 500（catch で alertCaughtError 経由）', async () => {
    const { alertCaughtError } = require('@/lib/alert');
    mockFrom.mockImplementation(() => {
      throw new Error('boom');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ token: VALID_TOKEN }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('サーバーエラーが発生しました');
    expect(alertCaughtError).toHaveBeenCalledWith('unsubscribe', expect.any(Error), '/api/unsubscribe');
    consoleSpy.mockRestore();
  });
});
