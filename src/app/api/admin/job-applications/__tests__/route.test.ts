/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/job-applications
 * Key assertions:
 *   - GET: Auth required, facility_members admin check
 *   - POST: Public endpoint (no auth/CSRF required)
 *   - Email validation
 *   - Duplicate application → 409
 *   - job_posting_id optional but must be UUID if provided
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID    = '22222222-2222-2222-2222-222222222222';
const JOB_POSTING_UUID = '44444444-4444-4444-4444-444444444444';
const USER_ID          = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: () => Promise.resolve({
    from: mockAnonFrom,
    auth: { getUser: mockGetUser },
  }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
  createServerSupabaseClient: () => ({ from: mockAnonFrom }),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/job-applications', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/job-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validPostBody(overrides: object = {}) {
  return {
    facility_id: FACILITY_UUID,
    applicant_name: '山田太郎',
    applicant_email: 'yamada@example.com',
    ...overrides,
  };
}

// GET: admin client handles facility_members (eq.in → Promise) and job_applications list
function membersChain(facilityIds: string[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: facilityIds.map((id) => ({ facility_id: id })), error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// POST: both admin calls use job_applications table (use callNum)
function dupCheckChain(existing: unknown[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data: existing, error: null })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
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
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 管理施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(membersChain([]));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with applications', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membersChain([FACILITY_UUID]);
    return listChain([{ id: 'app-1' }]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.applications).toBeDefined();
});

// ─── POST (public) ────────────────────────────────────────────────────────────

test('POST: facility_id 欠落 → 400', async () => {
  const res = await POST(makePostRequest({ applicant_name: '山田', applicant_email: 'a@b.com' }));
  expect(res.status).toBe(400);
});

test('POST: applicant_name 欠落 → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, applicant_email: 'a@b.com' }));
  expect(res.status).toBe(400);
});

test('POST: 不正メールアドレス → 400', async () => {
  const res = await POST(makePostRequest(validPostBody({ applicant_email: 'not-an-email' })));
  expect(res.status).toBe(400);
});

test('POST: 不正な facility_id → 400', async () => {
  const res = await POST(makePostRequest(validPostBody({ facility_id: 'bad-uuid' })));
  expect(res.status).toBe(400);
});

test('POST: job_posting_id が不正UUID → 400', async () => {
  const res = await POST(makePostRequest(validPostBody({ job_posting_id: 'bad-uuid' })));
  expect(res.status).toBe(400);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: 重複応募 → 409', async () => {
  mockAdminFrom.mockReturnValue(dupCheckChain([{ id: 'existing-app' }]));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(409);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常応募 → 201 with application', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-1', applicant_name: '山田太郎' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.application).toBeDefined();
});

test('POST: job_posting_id 付き応募 → 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-1' });
  });
  const res = await POST(makePostRequest(validPostBody({ job_posting_id: JOB_POSTING_UUID })));
  expect(res.status).toBe(201);
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('GET: rate limit params (20/60s)', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membersChain([FACILITY_UUID]);
    return listChain([]);
  });
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('POST: rate limit params (5/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-1' });
  });
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validPostBody()));
  const postCall = (inMemoryRateLimit as jest.Mock).mock.calls.find((c: unknown[]) => c[3] === 'job-apply');
  expect(postCall).toBeDefined();
  expect(postCall[1]).toBe(5);
  expect(postCall[2]).toBe(60_000);
});

test('GET: レスポンスが { applications: [] } 形式', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membersChain([FACILITY_UUID]);
    return listChain([]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json.applications)).toBe(true);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('POST: applicant_email 欠落 → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, applicant_name: '山田' }));
  expect(res.status).toBe(400);
});

test('GET: applications が null → 200 with []', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membersChain([FACILITY_UUID]);
    return listChain(null as unknown as unknown[]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.applications).toEqual([]);
});

test('POST: 不正JSONボディ → 400', async () => {
  const req = new NextRequest('http://localhost/api/admin/job-applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json {',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: ログイン中ユーザーで応募 → 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-2' });
  });
  // user is logged in (default mock)
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(201);
});

test('POST: 未ログインで応募 → 201 (applicant_user_id=null)', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-3' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(201);
});

test('POST: applicant_phone と cover_letter 付き → 201', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: 'app-4' });
  });
  const res = await POST(makePostRequest(validPostBody({
    applicant_phone: '09012345678',
    cover_letter: 'これは志望動機です',
  })));
  expect(res.status).toBe(201);
});

test('POST: existing が null → 201 (length checkの分岐)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain(null as unknown as unknown[]);
    return insertSingle({ id: 'app-5' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(201);
});

test('GET: x-forwarded-for ヘッダあり → IP抽出', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membersChain([FACILITY_UUID]);
    return listChain([]);
  });
  (inMemoryRateLimit as jest.Mock).mockClear();
  const req = new NextRequest('http://localhost/api/admin/job-applications', {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
  });
  await GET(req);
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('10.0.0.1');
});

test('POST: レスポンスが { application.id } 形式', async () => {
  const APP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return dupCheckChain([]);
    return insertSingle({ id: APP_UUID, applicant_name: '山田太郎' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(json.application.id).toBe(APP_UUID);
});

// Branch coverage: line 44 branch 0 (TRUE) — POST の checkCsrf が non-null を返すとき (CSRF失敗)
test('POST: CSRF検証失敗 → csrfError をそのまま返す', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })
  );
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

// Branch coverage: line 15 — getFacilityIds returns data=null → (data ?? []) right side → empty array []
// Branch coverage: line 44 — facilityIds.length === 0 → 403
test('GET: facility_members から data=null 返却 → facilityIds が空配列 → 403', async () => {
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: null, error: null })),
  });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});
