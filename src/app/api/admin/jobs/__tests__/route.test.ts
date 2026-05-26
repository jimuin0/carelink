/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/jobs
 * Key assertions:
 *   - No facility membership → empty list (GET) or 403 (POST)
 *   - Invalid jobFormSchema → 400
 *   - DB failure → 500
 */

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
  mutationRateLimit: {},
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit, checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/jobs', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new Request('http://localhost/api/admin/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validJob(overrides: object = {}) {
  return {
    title: 'テスト求人',
    job_type: 'ネイリスト',
    employment_type: '正社員',
    ...overrides,
  };
}

// facility_members list — ends with .in() as Promise
function membersChain(data: unknown[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// facility_jobs list — ends with .order() as Promise
function jobListChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error })),
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
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
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

test('GET: 施設メンバーシップなし → 200 jobs:[]', async () => {
  mockAnonFrom.mockReturnValue(membersChain([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.jobs).toEqual([]);
});

test('GET: 正常取得 → 200 with jobs', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID }]);
    return jobListChain([{ id: 'job-1', title: 'テスト求人' }]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.jobs.length).toBeGreaterThan(0);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validJob()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makePostRequest(validJob()));
  expect(res.status).toBe(429);
});

test('POST: 施設メンバーシップなし → 403', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([]); // POST body parsed before auth, so auth comes second
    return membersChain([]);
  });
  const res = await POST(makePostRequest(validJob()));
  expect(res.status).toBe(403);
});

test('POST: 不正な employment_type → 400', async () => {
  const res = await POST(makePostRequest(validJob({ employment_type: '無効な雇用形態' })));
  expect(res.status).toBe(400);
});

test('POST: title が空 → 400', async () => {
  const res = await POST(makePostRequest(validJob({ title: '' })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID }]);
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest(validJob()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with job', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID }]);
    return insertSingle({ id: 'job-1', title: 'テスト求人' });
  });
  const res = await POST(makePostRequest(validJob()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.job).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validJob()));
  expect(res.status).toBe(403);
});

test('GET: DB エラー → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID }]);
    return jobListChain([], { message: 'DB error' });
  });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: レスポンスが { jobs: [] } 形式', async () => {
  mockAnonFrom.mockReturnValue(membersChain([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.jobs).toBeDefined();
  expect(Array.isArray(json.jobs)).toBe(true);
});

test('POST: レスポンスが { job: ... } 形式', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID }]);
    return insertSingle({ id: 'job-1', title: 'テスト求人' });
  });
  const res = await POST(makePostRequest(validJob()));
  const json = await res.json();
  expect(json.job).toBeDefined();
  expect(json.job.id).toBe('job-1');
});

test('GET: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(membersChain([]));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});
