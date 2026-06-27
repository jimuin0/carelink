/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/white-label
 * Key assertions:
 *   - No facility membership → 403
 *   - domain format validation (label-safe regex, no ReDoS risk)
 *   - domain max 253 chars
 *   - primary_color must be #RRGGBB hex
 *   - logo_url must start with https://
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test-ua', ip: '127.0.0.1' })),
}));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/white-label', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/white-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function facilityIdChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function configSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function upsertSingle(data: unknown, error: unknown = null) {
  return {
    upsert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 設定なし → 200 config:null', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return configSingle(null);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.config).toBeNull();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest({ domain: 'example.com' }));
  expect(res.status).toBe(401);
});

test('POST: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await POST(makePostRequest({ domain: 'example.com' }));
  expect(res.status).toBe(403);
});

test('POST: domain が欠落 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({}));
  expect(res.status).toBe(400);
});

test('POST: domain が 254文字 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  // 63+1 repeated 4 times = 256 chars, plus 'com' = 259 chars total (> 253)
  const longDomain = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.com';
  const res = await POST(makePostRequest({ domain: longDomain }));
  expect(res.status).toBe(400);
});

test('POST: 不正なdomain形式 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({ domain: 'invalid_domain' })); // underscore not allowed
  expect(res.status).toBe(400);
});

test('POST: 単一ラベルのdomain → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({ domain: 'localhost' })); // needs at least 2 labels
  expect(res.status).toBe(400);
});

test('POST: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.example.com' }));
  expect(res.status).toBe(500);
  // DB失敗の500はSlack通知され、監査ログは書かれない
  const { alertCaughtError } = require('@/lib/alert');
  const { writeAuditLog } = require('@/lib/audit-logger');
  expect(alertCaughtError).toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('POST: 正常登録 → 201 with config（監査ログ記録）', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-1', domain: 'my.salon.example.com' });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.example.com', brand_name: 'My Salon' }));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.config).toBeDefined();
  // カスタムドメイン設定は監査ログに記録される
  const { writeAuditLog } = require('@/lib/audit-logger');
  expect(writeAuditLog).toHaveBeenCalledWith(
    expect.objectContaining({ tableName: 'white_label_domains', action: 'update', facilityId: FACILITY_UUID }),
  );
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest({ domain: 'example.com' }));
  expect(res.status).toBe(403);
});

test('POST: primary_color が不正形式 → デフォルト色で 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-x', domain: 'my.salon.jp', primary_color: '#0ea5e9' });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.jp', primary_color: 'red' }));
  expect(res.status).toBe(201);
});

test('POST: logo_url が http:// → null として保存されて 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-y', domain: 'my.salon.jp', logo_url: null });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.jp', logo_url: 'http://example.com/logo.png' }));
  expect(res.status).toBe(201);
});

test('POST: primary_color が #RRGGBB 形式 → 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-2', domain: 'my.salon.jp', primary_color: '#FF5733' });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.jp', primary_color: '#FF5733' }));
  expect(res.status).toBe(201);
});

test('GET: 設定あり → 200 with config', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return configSingle({ id: 'wl-1', domain: 'my.salon.jp' });
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.config).toBeDefined();
  expect(json.config.id).toBe('wl-1');
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest({ domain: 'example.com' }));
  expect(res.status).toBe(429);
});

test('POST: 不正なJSON → 400 (catchフォールバック)', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const req = new NextRequest('http://localhost/api/admin/white-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: brand_name と logo_url が正常 → 201 (truthy ブランチ)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-ok', domain: 'my.salon.jp', brand_name: 'ブランド', logo_url: 'https://cdn.example.com/logo.png' });
  });
  const res = await POST(makePostRequest({
    domain: 'my.salon.jp',
    brand_name: 'ブランド',
    logo_url: 'https://cdn.example.com/logo.png',
  }));
  expect(res.status).toBe(201);
});

test('POST: ラベル長 64 で domain 全体 ≤ 253 → 400 (ラベル長チェック)', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  // 1 label > 63 chars but total domain length ≤ 253
  const longLabel = 'a'.repeat(64);
  const res = await POST(makePostRequest({ domain: `${longLabel}.com` }));
  expect(res.status).toBe(400);
});

test('GET: x-forwarded-for ヘッダーなし → unknown としてレート制限', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return configSingle(null);
  });
  // No x-forwarded-for header set
  const req = new NextRequest('http://localhost/api/admin/white-label', { method: 'GET' });
  const res = await GET(req);
  expect(res.status).toBe(200);
});

test('POST: レスポンスが { config: ... } 形式', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return upsertSingle({ id: 'wl-3', domain: 'my.salon.jp' });
  });
  const res = await POST(makePostRequest({ domain: 'my.salon.jp' }));
  const json = await res.json();
  expect(json.config).toBeDefined();
  expect(json.config.id).toBe('wl-3');
});
