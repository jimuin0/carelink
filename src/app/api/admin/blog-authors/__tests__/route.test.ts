/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/blog-authors
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
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
  const url = new URL('http://localhost/api/admin/blog-authors');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}
function makePost(body: unknown, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/blog-authors');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function listChain(data: unknown[], error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data, error })) };
}
function countChain(count: number | null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ count })) }) };
}
function insertSingle(data: unknown, error: unknown = null) {
  return { insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}

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
test('GET: 正常 → 200', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminFrom.mockReturnValue(listChain([{ id: 'a', name: 'X' }])); const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).authors).toBeDefined(); });

// POST
test('POST: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await POST(makePost({ name: 'X' }))).status).toBe(403); });
test('POST: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await POST(makePost({ name: 'X' }))).status).toBe(429); });
test('POST: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await POST(makePost({ name: 'X' }))).status).toBe(401); });
test('POST: 名前空 → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makePost({ name: '' }))).status).toBe(400); });
test('POST: 不正JSON → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makePost('x'))).status).toBe(400); });
test('POST: 既に5名 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(5));
  expect((await POST(makePost({ name: 'X' }))).status).toBe(400);
});
test('POST: count null → 0扱いで作成 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(null)).mockReturnValueOnce(insertSingle({ id: 'a1', name: 'X' }));
  expect((await POST(makePost({ name: 'X' }))).status).toBe(201);
});
test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(2)).mockReturnValueOnce(insertSingle(null, { message: 'e' }));
  expect((await POST(makePost({ name: 'X' }))).status).toBe(500);
});
test('POST: 正常 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(countChain(2)).mockReturnValueOnce(insertSingle({ id: 'a2', name: 'X' }));
  const r = await POST(makePost({ name: 'X' }));
  expect(r.status).toBe(201);
  expect((await r.json()).author).toBeDefined();
});
