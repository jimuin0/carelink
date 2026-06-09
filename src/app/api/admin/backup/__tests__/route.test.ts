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
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function countChain(count: number) {
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    head: true,
    then: (fn: (v: unknown) => unknown) => Promise.resolve({ count }).then(fn),
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

// ─── POST: export failure ─────────────────────────────────────────────────────

test('POST: エクスポートクエリ失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn(() => Promise.resolve({ data: null, error: { message: 'query failed' } })),
      }),
    }),
  });

  const res = await POST(makePostRequest({ table: 'bookings' }));
  expect(res.status).toBe(500);
});

test('POST: データ0件 → 404', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn(() => Promise.resolve({ data: [], error: null })),
      }),
    }),
  });

  const res = await POST(makePostRequest({ table: 'bookings' }));
  expect(res.status).toBe(404);
});

// ─── POST: CSV injection prevention ──────────────────────────────────────────

test('POST: CSVインジェクション防止 (= で始まる値を引用符付き文字列に変換)', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn(() => Promise.resolve({
          data: [{ id: '=SUM(A1)', name: '=CMD|"/c calc"!A0', created_at: '2026-01-01' }],
          error: null,
        })),
      }),
    }),
  });

  const res = await POST(makePostRequest({ table: 'bookings' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // Values starting with = should be prefixed with ' to neutralize formula injection
  expect(csv).toContain("'=SUM(A1)");
  expect(csv).toContain("'=CMD");
});

test('POST: 正常CSVエクスポート → 200 Content-Type: text/csv', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn(() => Promise.resolve({
          data: [{ id: '1', name: '施設A', created_at: '2026-01-01' }],
          error: null,
        })),
      }),
    }),
  });

  const res = await POST(makePostRequest({ table: 'facility_profiles' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  expect(res.headers.get('Content-Disposition')).toContain('facility_profiles');
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('POST: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await POST(makePostRequest());
  expect(res).toBe(csrfRes);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest());
  expect(res.status).toBe(429);
});

test('POST: profile レコードなし (null) → 403', async () => {
  mockAnonFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
  });
  const res = await POST(makePostRequest());
  expect(res.status).toBe(403);
});

test('POST: 不正な JSON body → 400 (table 欠落)', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const req = new NextRequest('http://localhost/api/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: CSV 値に null/undefined/object/カンマ含む → 適切にエスケープ', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        range: jest.fn(() => Promise.resolve({
          data: [{
            id: '1',
            nullable: null,
            undef: undefined,
            obj: { foo: 'bar' },
            csv: 'a,b',
            quote: 'has "quote"',
            newline: 'a\nb',
          }],
          error: null,
        })),
      }),
    }),
  });
  const res = await POST(makePostRequest({ table: 'bookings' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('"a,b"');
  expect(csv).toContain('"has ""quote"""');
  // JSON オブジェクトは JSON.stringify → CSV クォート（" → ""）でエスケープされる
  expect(csv).toContain('"{""foo"":""bar""}"');
});

test('GET: NEXT_PUBLIC_SUPABASE_URL 未設定 → unknown', async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      then: (fn: (v: unknown) => unknown) => Promise.resolve({ count: 0 }).then(fn),
    }),
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.supabase_project).toBe('unknown');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

test('GET: count が null → 0 にフォールバック', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      then: (fn: (v: unknown) => unknown) => Promise.resolve({ count: null }).then(fn),
    }),
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.table_counts.bookings).toBe(0);
});
