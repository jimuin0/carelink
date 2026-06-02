/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/photos
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeGet(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/photos');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}
function makePost(body: unknown, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/photos');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function listChain(data: unknown[], error: unknown = null) {
  // 多段 .order() に対応するため order はチェーン可能にし、await は then で解決する
  const chain: Record<string, unknown> = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  return chain;
}
// 新規 sort_order 採番は「現存最大 +1」(#22)。max(sort_order) 取得チェーンを模す（引数=現存最大、null=行なし）。
function countChain(maxSort: number | null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ maybeSingle: jest.fn(() => Promise.resolve({ data: maxSort === null ? null : { sort_order: maxSort } })) }) }) }) }) };
}
function insertSingle(data: unknown, error: unknown = null) {
  return { insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}
function validBody(o: object = {}) { return { photo_url: 'https://example.invalid/a.jpg', photo_type: 'other', ...o }; }

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

// GET
test('GET: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await GET(makeGet())).status).toBe(429); });
test('GET: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await GET(makeGet())).status).toBe(401); });
test('GET: facility_id なし → 401', async () => { expect((await GET(makeGet(null))).status).toBe(401); });
test('GET: facility_id 不正 → 401', async () => { expect((await GET(makeGet('bad'))).status).toBe(401); });
test('GET: 非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await GET(makeGet())).status).toBe(401); });
test('GET: DBエラー → 500', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminFrom.mockReturnValue(listChain([], { message: 'e' })); expect((await GET(makeGet())).status).toBe(500); });
test('GET: 正常 → 200', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminFrom.mockReturnValue(listChain([{ id: 'p' }])); const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).photos).toBeDefined(); });

// POST
test('POST: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await POST(makePost(validBody()))).status).toBe(403); });
test('POST: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await POST(makePost(validBody()))).status).toBe(429); });
test('POST: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await POST(makePost(validBody()))).status).toBe(401); });
test('POST: バリデーション失敗(photo_url空) → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makePost({ photo_url: '' }))).status).toBe(400); });
test('POST: 不正JSON → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makePost('x'))).status).toBe(400); });
test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(0)).mockReturnValueOnce(insertSingle(null, { message: 'e' }));
  expect((await POST(makePost(validBody()))).status).toBe(500);
});
test('POST: sort_order 未指定 → count で補完して 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(5)).mockReturnValueOnce(insertSingle({ id: 'p1' }));
  expect((await POST(makePost(validBody()))).status).toBe(201);
});
test('POST: count が null でも 201（?? 0）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(null)).mockReturnValueOnce(insertSingle({ id: 'p2' }));
  expect((await POST(makePost(validBody()))).status).toBe(201);
});
test('POST: sort_order 明示指定 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(0)).mockReturnValueOnce(insertSingle({ id: 'p3' }));
  expect((await POST(makePost(validBody({ sort_order: 3 })))).status).toBe(201);
});

// ─── coupon_id 施設所有検証（#3） ──────────────────────────────────────────────
function scopeRow(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data })) };
}
const VALID_COUPON = '88888888-8888-4888-8888-888888888888';
test('POST: coupon_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null));
  expect((await POST(makePost(validBody({ coupon_id: VALID_COUPON })))).status).toBe(400);
});
test('POST: coupon_id が自施設 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_COUPON })).mockReturnValueOnce(countChain(0)).mockReturnValueOnce(insertSingle({ id: 'pc' }));
  expect((await POST(makePost(validBody({ coupon_id: VALID_COUPON })))).status).toBe(201);
});
