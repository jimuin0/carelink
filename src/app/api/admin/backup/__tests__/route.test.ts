/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/backup
 * Key assertions:
 *   - GET/POST: non-platform-admin → 403
 *   - POST: table not in allowlist → 400 (prevents arbitrary table dump)
 *   - POST: CSV injection prevention (values starting with = → prefixed with ')
 *   - POST: export query failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test', ip: '127.0.0.1' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

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
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/backup', { method: 'GET' });
}

function makePostRequest(body: object = { table: 'bookings' }) {
  return new NextRequest('http://localhost/api/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET: platform-admin guard ────────────────────────────────────────────────

test('GET: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: platform_admin → 200 with table_counts', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  // All count queries return 0
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      then: (fn: (v: unknown) => unknown) => Promise.resolve({ count: 0 }).then(fn),
    }),
  });

  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.status).toBe('ok');
  expect(json.table_counts).toBeDefined();
});

test('GET: 行数照会エラー → degraded と null・failed_tables を返す', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      then: (fn: (v: unknown) => unknown) => Promise.resolve({ count: null, error: { message: 'count failed' } }).then(fn),
    }),
  });

  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.status).toBe('degraded');
  expect(json.table_counts.bookings).toBeNull();
  expect(json.failed_tables).toHaveLength(8);
});

test('GET: 行数照会の例外 → degraded として返す', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown, reject: (reason: Error) => unknown) =>
        Promise.reject(new Error('count exception')).then(resolve, reject),
    }),
  });

  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.status).toBe('degraded');
  expect(json.failed_tables).toHaveLength(8);
});

// ─── POST: platform-admin guard ───────────────────────────────────────────────

test('POST: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest());
  expect(res.status).toBe(403);
});

test('POST: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await POST(makePostRequest());
  expect(res.status).toBe(403);
});

// ─── POST: table whitelist (SQL injection prevention) ────────────────────────

test('POST: 許可されていないテーブル名 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await POST(makePostRequest({ table: 'api_keys' }));
  expect(res.status).toBe(400);
});

test('POST: テーブル名にSQLインジェクション試行 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await POST(makePostRequest({ table: "bookings; DROP TABLE profiles;--" }));
  expect(res.status).toBe(400);
});

test('POST: テーブル名なし → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await POST(makePostRequest({}));
  expect(res.status).toBe(400);
});


// Query mocks consume pages and expose the real cursor, limit and abort contract.
type PageResult = { data: unknown; error?: unknown };
function mockExportPages(...pages: Array<PageResult | Error | string>) {
  const read = jest.fn(async () => {
    const result = pages.shift() ?? { data: [], error: null };
    if (result instanceof Error || typeof result === 'string') throw result;
    return result;
  });
  const query = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    abortSignal: jest.fn().mockReturnThis(),
    then: (resolve: (value: PageResult) => unknown, reject: (reason: unknown) => unknown) => read().then(resolve, reject),
  };
  mockAdminFrom.mockReturnValue(query);
  return { query, read };
}
function row(i: number, values: Record<string, unknown> = {}) {
  return { id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, created_at: '2026-01-01', ...values };
}
function admin() { mockAnonFrom.mockReturnValue(profileChain(true)); }

import { writeAuditLog } from '@/lib/audit-logger';

test.each([
  { data: null, error: { message: 'query failed' } },
  { data: null, error: null },
  { data: {} },
  { data: [row(0)], error: { message: 'partial result' } },
  { data: [{ id: 1 }] },
])('POST: invalid first read %j returns500 before CSV headers', async result => {
  admin(); mockExportPages(result);
  const response = await POST(makePostRequest());
  expect(response.status).toBe(500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each([new Error('connection lost'), 'connection lost'])('POST: first read rejects %p returns500', async failure => {
  admin(); mockExportPages(failure);
  expect((await POST(makePostRequest())).status).toBe(500);
});

test('POST: empty first page returns404', async () => {
  admin(); mockExportPages({ data: [] });
  expect((await POST(makePostRequest())).status).toBe(404);
});

test('POST: JSON null, array or scalar is a400 rather than a server exception', async () => {
  admin();
  for (const body of ['null', '[]', '123', '"bookings"', 'invalid-json']) {
    const request = new NextRequest('http://localhost/api/admin/backup', { method: 'POST', body });
    expect((await POST(request)).status).toBe(400);
  }
  expect(mockAdminFrom).not.toHaveBeenCalled();
});

test('POST: CSRF is returned without DB reads', async () => {
  const blocked = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(blocked);
  expect(await POST(makePostRequest())).toBe(blocked);
  expect(mockAdminFrom).not.toHaveBeenCalled();
});

test('POST: rate limit returns429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await POST(makePostRequest())).status).toBe(429);
});

test('POST: absent platform role returns403', async () => {
  mockAnonFrom.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: async () => ({ data: null, error: null }) });
  expect((await POST(makePostRequest())).status).toBe(403);
});

test.each(['bookings', 'facility_profiles', 'profiles', 'facility_reviews'])('POST: complete CSV %s records completion only after EOF', async table => {
  admin(); const { query } = mockExportPages({ data: [row(0, { name: '施設A' })] });
  const response = await POST(makePostRequest({ table }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/csv');
  expect(response.headers.get('Content-Disposition')).toContain(table);
  expect(writeAuditLog).not.toHaveBeenCalled();
  expect(await response.text()).toContain('施設A');
  expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
  expect(query.gt).toHaveBeenCalledWith('id', row(0).id);
  expect(query.limit).toHaveBeenCalledWith(1000);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: { row_count: 1 } }));
});

test('POST: smaller server cap does not terminate an export early; equal timestamps remain ordered by ID', async () => {
  admin(); const { query, read } = mockExportPages({ data: [row(0), row(1)] }, { data: [row(2)] });
  const response = await POST(makePostRequest());
  const csv = await response.text();
  expect(csv.trim().split('\n')).toHaveLength(4);
  expect(read).toHaveBeenCalledTimes(3);
  expect(query.gt.mock.calls).toEqual([['id', row(1).id], ['id', row(2).id]]);
});

test('POST: consumer demand bounds page reads, and cancellation aborts without a completed audit', async () => {
  admin(); const { read, query } = mockExportPages({ data: [row(0)] }, { data: [row(1)] });
  const response = await POST(makePostRequest());
  await new Promise(resolve => setImmediate(resolve));
  expect(read).toHaveBeenCalledTimes(1);
  const reader = response.body!.getReader();
  await reader.read();
  await new Promise(resolve => setImmediate(resolve));
  expect(read).toHaveBeenCalledTimes(1);
  await reader.cancel();
  expect(read).toHaveBeenCalledTimes(1);
  expect(query.abortSignal.mock.calls[0][0].aborted).toBe(true);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('POST: deleting an earlier row between pages does not skip the remaining rows', async () => {
  admin();
  let records = Array.from({ length: 6 }, (_, i) => row(i));
  let afterId = '';
  const query = {
    select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), abortSignal: jest.fn().mockReturnThis(),
    gt: jest.fn((_column: string, cursor: string) => { afterId = cursor; return query; }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: records.filter(item => item.id > afterId).slice(0, 2), error: null,
    }).then(resolve),
  };
  mockAdminFrom.mockReturnValue(query);
  const response = await POST(makePostRequest());
  const reader = response.body!.getReader();
  const chunks = [new TextDecoder().decode((await reader.read()).value)];
  records = records.filter(item => item.id !== row(0).id);
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(new TextDecoder().decode(next.value));
  }
  const csv = chunks.join('');
  for (let i = 0; i < 6; i++) expect(csv.match(new RegExp(row(i).id, 'g'))).toHaveLength(1);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: { row_count: 6 } }));
});

test.each([
  { data: null, error: { message: 'page failed' } },
  { data: null },
  { data: [row(1)], error: { message: 'partial page' } },
  { data: [row(0)] },
  new Error('connection lost'),
  'connection lost',
])('POST: later failure %p rejects the CSV body without a completed audit', async result => {
  admin(); mockExportPages({ data: [row(0)] }, result);
  const response = await POST(makePostRequest());
  expect(response.status).toBe(200);
  await expect(response.text()).rejects.toThrow();
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('POST: CSV handles null, missing, object, comma, quotes and newlines', async () => {
  admin(); mockExportPages({ data: [row(0, { nullable: null, missing: undefined, object: { foo: 'bar' }, comma: 'a,b', quote: 'has "quote"', newline: 'a\nb' })] });
  const csv = await (await POST(makePostRequest())).text();
  expect(csv).toContain('"a,b"');
  expect(csv).toContain('"has ""quote"""');
  expect(csv).toContain('"{""foo"":""bar""}"');
  expect(csv).toContain('"a\nb"');
});

test.each(['=SUM(A1)', '+CMD', '-1+2', '@SUM(1,2)', '\t=1+2', '\r=1+2', '\n=1+2', '  =1+2', '\uFEFF=1+2', '＝1+2', '＋1+2', '－1+2', '＠SUM(1,2)'])('POST: untrusted CSV text %j is escaped', async value => {
  admin(); mockExportPages({ data: [row(0, { name: value })] });
  const csv = await (await POST(makePostRequest())).text();
  expect(csv).toContain("'" + value.replace(/"/g, '""'));
});

test('POST: carriage returns and semicolons are quoted', async () => {
  admin(); mockExportPages({ data: [row(0, { name: 'safe\rtext', note: 'safe;=1+2' })] });
  const csv = await (await POST(makePostRequest())).text();
  expect(csv).toContain('"safe\rtext"');
  expect(csv).toContain('"safe;=1+2"');
});

test.each([null, undefined, -1, 1.5, '0', Infinity])('GET: invalid count %p is degraded, not zero', async count => {
  admin(); mockAdminFrom.mockReturnValue({ select: () => Promise.resolve({ count, error: null }) });
  const result = await (await GET(makeGetRequest())).json();
  expect(result.status).toBe('degraded');
  expect(result.table_counts.bookings).toBeNull();
  expect(result.failed_tables).toHaveLength(8);
});

test('GET: missing project URL returns unknown', async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  admin(); mockAdminFrom.mockReturnValue({ select: () => Promise.resolve({ count: 0 }) });
  expect((await (await GET(makeGetRequest())).json()).supabase_project).toBe('unknown');
});
