/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/white-label/verify
 * Key assertions:
 *   - DNS verified but DB write fails → 500 (previously returned { verified: true } — bug)
 *   - DNS lookup failure → 200 { verified: false } (not an error)
 *   - TXT record mismatch → 200 { verified: false }
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('dns', () => ({ promises: { resolveTxt: jest.fn() } }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: jest.fn(), auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { promises as dns } from 'dns';

const DOMAIN_CONFIG = {
  domain: 'example-salon.com',
  txt_record: 'carelink-verify=abc123xyz',
};

function makeRequest() {
  return new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// Helper: setup ownership + domain config chain
function setupOwnershipAndDomain(updateError: unknown = null) {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // membership
    if (callNum === 2) return singleChain(DOMAIN_CONFIG); // domain config
    return updateChain(updateError); // verify update
  });
}

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('施設が見つからない → 403', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null)); // no facility membership
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('ドメイン設定なし → 400', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return singleChain(null); // no domain config
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

// ─── DNS verification ─────────────────────────────────────────────────────────

test('DNS lookup失敗 → 200 { verified: false, reason: DNS lookup failed }', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return singleChain(DOMAIN_CONFIG);
  });
  (dns.resolveTxt as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
  expect(json.reason).toBe('DNS lookup failed');
});

test('TXTレコード不一致 → 200 { verified: false }', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return singleChain(DOMAIN_CONFIG);
  });
  (dns.resolveTxt as jest.Mock).mockResolvedValue([['wrong-record']]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
});

// ─── Critical: DB write failure after successful verification ─────────────────

test('DNS検証成功 + DB書き込み失敗 → 500 (以前はverified:trueを返していたバグ)', async () => {
  setupOwnershipAndDomain({ message: 'DB update failed' });
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  // Must return 500 — returning verified:true without DB persistence would mean
  // the domain appears verified on next request but the DB disagrees
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('DNS検証成功 + DB更新成功 → 200 { verified: true }', async () => {
  setupOwnershipAndDomain(null); // no DB error
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(true);
});

test('ネストしたTXTレコード配列も正しく照合される', async () => {
  setupOwnershipAndDomain(null);
  // resolveTxt returns array of arrays (chunked records)
  (dns.resolveTxt as jest.Mock).mockResolvedValue([
    ['other-record'],
    [DOMAIN_CONFIG.txt_record],
  ]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(true);
});

test('レートリミット params', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makeRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBeGreaterThan(0);
  expect(call[2]).toBe(60_000);
});

test('レスポンスが { verified: true } 形式', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(json.verified).toBe(true);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('x-forwarded-for ヘッダあり → IP抽出', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  (inMemoryRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
    body: '{}',
  });
  await POST(req);
  expect((inMemoryRateLimit as jest.Mock).mock.calls[0][0]).toBe('1.2.3.4');
});
