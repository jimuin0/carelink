/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/white-label/verify
 * Key assertions:
 *   - DNS verified but DB write fails → 500 (previously returned { verified: true } — bug)
 *   - DNS lookup failure → 200 { verified: false } (not an error)
 *   - TXT record mismatch → 200 { verified: false }
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
import { checkRateLimit } from '@/lib/rate-limit';
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

// 監査A2: getAdminFacilityIds は .select().eq().in() が直接配列Promiseを返す形（single()なし）。
function facilityIdsChain(facilityIds: string[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: facilityIds.map((facility_id) => ({ facility_id })) })),
  };
}

// update().eq('facility_id',...).eq('domain',...).eq('txt_record',...).select('facility_id')
// TOCTOU根治後は複数 .eq() を経て最後に .select() で更新行を受け取る形になる。
// updatedRows 省略時は「error 無し→1行更新」「error 有り→null」を既定値とする。
function updateChain(error: unknown = null, updatedRows?: unknown[] | null) {
  const rows = updatedRows !== undefined ? updatedRows : (error ? null : [{ facility_id: FACILITY_UUID }]);
  const chainObj: Record<string, jest.Mock> = {};
  chainObj.eq = jest.fn(() => chainObj);
  chainObj.select = jest.fn(() => Promise.resolve({ data: rows, error }));
  return {
    update: jest.fn(() => chainObj),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// Helper: setup ownership + domain config chain
function setupOwnershipAndDomain(updateError: unknown = null, updatedRows?: unknown[] | null) {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]); // membership
    if (callNum === 2) return singleChain(DOMAIN_CONFIG); // domain config
    return updateChain(updateError, updatedRows); // verify update
  });
}

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(facilityIdsChain([]));
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('施設が見つからない → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([])); // no facility membership
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('ドメイン設定なし → 400', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
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
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
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
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
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

// ─── TOCTOU: DNS待機中にドメイン/TXTレコードが変更された場合の恒久根治 ─────────
test('DNS待機中にドメイン設定が変更された(0行更新) → verified:false(古い設定を検証済みと偽らない)', async () => {
  setupOwnershipAndDomain(null, []); // update matches 0 rows (domain/txt_record changed mid-flight)
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
  expect(json.reason).toBe('Domain configuration changed during verification');
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makeRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBeGreaterThan(0);
  expect(call[3]).toBe(60_000);
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
  (checkRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
    body: '{}',
  });
  await POST(req);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

// ─── 監査A2: 複数施設所有者の非決定的施設選択の根治確認 ────────────────────────

const FACILITY_UUID_2 = '44444444-4444-4444-4444-444444444444';

function makeRequestWithFacilityId(facilityId: string) {
  return new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facility_id: facilityId }),
  });
}

test('複数施設所有・facility_id未指定 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([FACILITY_UUID, FACILITY_UUID_2]));
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([FACILITY_UUID, FACILITY_UUID_2]));
  const res = await POST(makeRequestWithFacilityId('99999999-9999-9999-9999-999999999999'));
  expect(res.status).toBe(403);
});

test('不正なJSON body → catchでfacility_id未指定扱い（単一施設なら自動選択）', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  const req = new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
});
