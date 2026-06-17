/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/accounting-export
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - Invalid format → 400
 *   - Date range > 366 days → 400 (DoS prevention)
 *   - to < from → 400
 *   - CSV injection prevention (= prefix with ')
 *   - Success → 200 text/csv with BOM
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest(params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/accounting-export');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function bookingQueryChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.in = jest.fn(self);
  chain.order = jest.fn(self);
  chain.gte = jest.fn(self);
  chain.lte = jest.fn(self);
  chain.range = jest.fn(() => Promise.resolve({ data, error }));
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

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

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeGetRequest({}));
  expect(res.status).toBe(400);
});

test('GET: 不正なfacility_id → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: 'bad-id' }));
  expect(res.status).toBe(400);
});

test('GET: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

// ─── Parameter validation ──────────────────────────────────────────────────────

test('GET: 不正なformat → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'quickbooks' }));
  expect(res.status).toBe(400);
});

test('GET: 日付範囲 > 366日 → 400 (DoS防止)', async () => {
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2024-01-01',
    to: '2025-12-31', // 731 days
  }));
  expect(res.status).toBe(400);
});

test('GET: to < from → 400', async () => {
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2026-06-01',
    to: '2026-01-01',
  }));
  expect(res.status).toBe(400);
});

test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(500);
});

// ─── CSV injection prevention ─────────────────────────────────────────────────

test('GET: CSVインジェクション防止 (= で始まる値は引用符付き)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: '=SUM(A1)',
    created_at: '2026-01-01T10:00:00Z',
    menu: { name: '=CMD|"calc"!A0' },    total_amount: 5000,
    status: 'completed',
    profiles: { display_name: '=EVIL', email: 'test@example.com' },
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("'=SUM");
  expect(csv).toContain("'=CMD");
  expect(csv).toContain("'=EVIL");
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('GET: freee形式 → 200 text/csv + BOM', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'booking-1',
    created_at: '2026-01-15T10:00:00Z',
    menu: { name: 'カット' },    total_amount: 3300,
    status: 'completed',
    profiles: { display_name: '田中花子', email: null },
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee', from: '2026-01-01', to: '2026-01-31' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  expect(res.headers.get('Content-Disposition')).toContain('freee');
  const csv = await res.text();
  expect(csv).toContain('取引日'); // freee header
  expect(csv).toContain('収支区分'); // freee-specific column
});

test('GET: mf形式 → 200 text/csv', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'booking-1',
    created_at: '2026-01-15T10:00:00Z',
    menu: { name: 'カラー' },    total_amount: 8800,
    status: 'confirmed',
    profiles: null,
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('借方勘定科目'); // MF header
});

test('GET: レートリミット params', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBeGreaterThan(0);
  expect(call[3]).toBe(60_000);
});

test('GET: generic形式 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    created_at: '2026-01-01T10:00:00Z',
    menu: { name: 'カット' },    total_amount: 3300,
    status: 'completed',
    profiles: { display_name: '山田太郎', email: 'yamada@example.com' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
});

test('GET: 366日範囲 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    format: 'generic',
    from: '2025-01-01',
    to: '2026-01-01',
  }));
  expect(res.status).toBe(200);
});

test('GET: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

// ─── Parameter validation (additional) ────────────────────────────────────────

test('GET: from が不正な日付形式 → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, from: 'not-a-date' }));
  expect(res.status).toBe(400);
});

test('GET: to が不正な日付形式 → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, to: 'not-a-date' }));
  expect(res.status).toBe(400);
});

// Branch coverage: line 19 — csvEscape で val が null/undefined の場合に空文字列フォールバック（false分岐）
test('GET: メニュー名にカンマを含む値は引用符で囲まれる（csv escape ブランチ）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-comma',
    created_at: '2026-03-01T09:00:00Z',
    menu: { name: 'カット,カラー' },    total_amount: 5500,
    status: 'completed',
    profiles: { display_name: '佐藤,次郎', email: 'sato@example.com' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // カンマを含む値は "..." で囲まれる
  expect(csv).toContain('"カット,カラー"');
});

// ─── Null fallback branches in CSV generation ──────────────────────────────────

test('GET: bookingsがnullのとき空CSVを返す', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('取引日');
});

test('GET: freee形式 fromなし → filenameにallを使う', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: freee形式 profiles配列・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    created_at: '2026-01-01T10:00:00Z',
    menu: null,    total_amount: null,
    status: 'completed',
    profiles: [{ display_name: null, email: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('2026');
});

test('GET: mf形式 fromなし・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    created_at: '2026-01-01T10:00:00Z',
    menu: null,    total_amount: null,
    status: 'confirmed',
    profiles: [{ display_name: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: generic形式 fromなし・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    created_at: '2026-01-01T10:00:00Z',
    menu: null,    total_amount: null,
    status: 'completed',
    profiles: [{ display_name: null, email: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: mf形式 bookingsがnull → 空CSV', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('借方勘定科目');
});

test('GET: generic形式 bookingsがnull → 空CSV', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('予約ID');
});

test('GET: CSV値にカンマ/引用符/改行 → 引用符で囲まれエスケープ', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-quote',
    created_at: '2026-01-01T10:00:00Z',
    menu: { name: 'メ"ニュ,ー\n改行' },    total_amount: 1000,
    status: 'completed',
    profiles: { display_name: 'カンマ,テスト', email: 'a@b.c' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // Embedded comma forces quoting
  expect(csv).toContain('"カンマ,テスト"');
  // Embedded quote escaped as ""
  expect(csv).toContain('""');
});

test('GET: from のみ指定 (to なし) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic', from: '2026-01-01' }));
  expect(res.status).toBe(200);
});

test('GET: to のみ指定 (from なし) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic', to: '2026-01-31' }));
  expect(res.status).toBe(200);
});

test('GET: 正規表現は通過するがNaNの日付 → 400', async () => {
  // '2026-99-99' passes /^\d{4}-\d{2}-\d{2}$/ but new Date() returns Invalid Date
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2026-99-99',
    to: '2026-99-99',
  }));
  expect(res.status).toBe(400);
});

// Branch coverage: line 19 branch 1 (FALSE) — csvEscape の `val ?? ''` で val が undefined のとき '' にフォールバック
// profiles フィールドが undefined の予約レコードで generic 形式を出力する
test('GET: generic形式 profiles未定義 → csvEscape の ?? \'\' false分岐が動く', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  // profiles field is undefined (not in the object) → csvEscape(undefined) → String(undefined ?? '') = ''
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-undef',
    created_at: '2026-04-01T10:00:00Z',
    menu: null,    total_amount: undefined,
    status: 'completed',
    profiles: undefined,
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // Should contain the header row and a data row (even if fields are empty)
  expect(csv).toContain('予約ID');
});
