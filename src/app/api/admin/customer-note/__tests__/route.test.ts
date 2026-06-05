/**
 * @jest-environment node
 *
 * Tests for GET/PUT /api/admin/customer-note (お客様カルテ メモ/タグ/次回案内 #42-#45)
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
import { GET, PUT } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeGet(params: Record<string, string> = { facility_id: FACILITY_UUID, customer_key: 'a@b.com' }) {
  const url = new URL('http://localhost/api/admin/customer-note');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { method: 'GET' });
}
function makePut(body: unknown, params: Record<string, string> = { facility_id: FACILITY_UUID, customer_key: 'a@b.com' }) {
  const url = new URL('http://localhost/api/admin/customer-note');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
// bookings: select('email, customer_name').eq('facility_id', x) を await
function bookingsChain(data: unknown[] | null, error: unknown = null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ data, error })) }) };
}
// salon_customer_notes GET: select().eq().eq().maybeSingle()
function noteSelectChain(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn(() => Promise.resolve({ data, error })) }) }) }) };
}
// salon_customer_notes PUT: upsert().select().single()
function upsertChain(data: unknown, error: unknown = null) {
  return { upsert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data, error })) }) }) };
}
// table 名でチェーンを振り分け
function routeAdmin(booking: ReturnType<typeof bookingsChain>, note: object) {
  mockAdminFrom.mockImplementation((table: string) => (table === 'bookings' ? booking : note));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
});

// ── GET ──
test('GET: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await GET(makeGet())).status).toBe(429); });
test('GET: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await GET(makeGet())).status).toBe(401); });
test('GET: facility_id なし → 401', async () => { expect((await GET(makeGet({ customer_key: 'a@b.com' }))).status).toBe(401); });
test('GET: facility_id 不正 → 401', async () => { expect((await GET(makeGet({ facility_id: 'bad', customer_key: 'a@b.com' }))).status).toBe(401); });
test('GET: 非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await GET(makeGet())).status).toBe(401); });
test('GET: customer_key なし → 400', async () => { expect((await GET(makeGet({ facility_id: FACILITY_UUID }))).status).toBe(400); });
test('GET: customer_key 長すぎ → 400', async () => { expect((await GET(makeGet({ facility_id: FACILITY_UUID, customer_key: 'x'.repeat(255) }))).status).toBe(400); });
test('GET: 当該施設に存在しない顧客 → note:null（email/氏名とも空の予約も含む）', async () => {
  // {email:null, customer_name:null} 行で bookingKey の '' フォールバック分岐も網羅
  routeAdmin(bookingsChain([{ email: null, customer_name: null }, { email: 'other@b.com', customer_name: null }]), noteSelectChain(null));
  const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).note).toBeNull();
});
test('GET: 存在する顧客・メモなし → note:null（email一致）', async () => {
  routeAdmin(bookingsChain([{ email: 'A@B.com', customer_name: null }]), noteSelectChain(null));
  const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).note).toBeNull();
});
test('GET: 存在する顧客（氏名一致・emailなし）・メモあり → 200', async () => {
  routeAdmin(bookingsChain([{ email: null, customer_name: 'a@b.com' }]), noteSelectChain({ note: 'メモ', tags: ['VIP'], next_visit_date: null, next_visit_note: null }));
  const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).note.note).toBe('メモ');
});
test('GET: bookings が null でも安全（存在せず note:null）', async () => {
  routeAdmin(bookingsChain(null), noteSelectChain(null));
  const r = await GET(makeGet()); expect(r.status).toBe(200); expect((await r.json()).note).toBeNull();
});
test('GET: メモ取得 DBエラー → 500', async () => {
  routeAdmin(bookingsChain([{ email: 'a@b.com', customer_name: null }]), noteSelectChain(null, { message: 'e' }));
  expect((await GET(makeGet())).status).toBe(500);
});

// ── PUT ──
test('PUT: CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await PUT(makePut({ note: 'x' }))).status).toBe(403); });
test('PUT: レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await PUT(makePut({ note: 'x' }))).status).toBe(429); });
test('PUT: 未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await PUT(makePut({ note: 'x' }))).status).toBe(401); });
test('PUT: customer_key なし → 400', async () => { expect((await PUT(makePut({ note: 'x' }, { facility_id: FACILITY_UUID }))).status).toBe(400); });
test('PUT: customer_key 長すぎ → 400', async () => { expect((await PUT(makePut({ note: 'x' }, { facility_id: FACILITY_UUID, customer_key: 'x'.repeat(255) }))).status).toBe(400); });
test('PUT: 不正JSON → 400', async () => { expect((await PUT(makePut('not-json'))).status).toBe(400); });
test('PUT: バリデーション失敗（tags 過多） → 400', async () => { expect((await PUT(makePut({ tags: Array.from({ length: 21 }, () => 't') }))).status).toBe(400); });
test('PUT: next_visit_date 不正（2026-02-30） → 400', async () => { expect((await PUT(makePut({ next_visit_date: '2026-02-30' }))).status).toBe(400); });
test('PUT: 当該施設に存在しない顧客 → 400', async () => {
  routeAdmin(bookingsChain([{ email: 'other@b.com', customer_name: null }]), upsertChain(null));
  expect((await PUT(makePut({ note: 'x' }))).status).toBe(400);
});
test('PUT: upsert DBエラー → 500', async () => {
  routeAdmin(bookingsChain([{ email: 'a@b.com', customer_name: null }]), upsertChain(null, { message: 'e' }));
  expect((await PUT(makePut({ note: 'x' }))).status).toBe(500);
});
test('PUT: 正常保存 → 200（全項目）', async () => {
  routeAdmin(bookingsChain([{ email: 'a@b.com', customer_name: null }]), upsertChain({ note: 'm', tags: ['VIP'], next_visit_date: '2026-07-01', next_visit_note: '次回案内' }));
  const r = await PUT(makePut({ note: 'm', tags: ['VIP'], next_visit_date: '2026-07-01', next_visit_note: '次回案内' }));
  expect(r.status).toBe(200); expect((await r.json()).note.note).toBe('m');
});
test('PUT: 空ボディ（全省略）でも 200（既定値で保存）', async () => {
  routeAdmin(bookingsChain([{ email: 'a@b.com', customer_name: null }]), upsertChain({ note: null, tags: [], next_visit_date: null, next_visit_note: null }));
  expect((await PUT(makePut({}))).status).toBe(200);
});
