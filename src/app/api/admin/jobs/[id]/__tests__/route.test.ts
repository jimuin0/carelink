/**
 * @jest-environment node
 *
 * Tests for GET/PATCH/DELETE /api/admin/jobs/[id]
 * Key assertions:
 *   - Invalid UUID → 400
 *   - No facility membership → 403
 *   - Job not owned by user's facility → 404
 *   - Invalid jobFormSchema (bad employment_type) → 400
 *   - PATCH: facility_id defence-in-depth in UPDATE WHERE
 *   - DELETE: facility_id defence-in-depth in DELETE WHERE
 */

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
  mutationRateLimit: {},
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const JOB_UUID      = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));

import { NextRequest } from 'next/server';
import { GET, PATCH, DELETE } from '../route';
import { inMemoryRateLimit, checkRateLimit } from '@/lib/rate-limit';

function makeProps(id = JOB_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeGetRequest() {
  return new NextRequest(`http://localhost/api/admin/jobs/${JOB_UUID}`, { method: 'GET' });
}

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/admin/jobs/${JOB_UUID}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function validJob() {
  return {
    title: 'テスト求人',
    job_type: 'ネイリスト',
    employment_type: '正社員',
    salary_min: 200000,
    salary_max: 300000,
  };
}

const MOCK_JOB = { id: JOB_UUID, facility_id: FACILITY_UUID, title: 'テスト求人', job_type: 'ネイリスト', employment_type: '正社員' };

// facility_members list — ends with .in() as Promise
function membersChain(data: unknown[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// facility_jobs SELECT — ends with .single()
function jobSelectChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function jobUpdateChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
      }),
    }),
  };
}

function jobDeleteChain(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

function setupAuthorize(job: unknown = MOCK_JOB) {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    return jobSelectChain(job);
  });
  return () => callNum;
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
  const res = await GET(makeGetRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('GET: 不正なUUID → 400', async () => {
  const res = await GET(makeGetRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('GET: 施設メンバーシップなし → 403', async () => {
  mockAnonFrom.mockImplementationOnce(() => membersChain([]));
  const res = await GET(makeGetRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('GET: 求人が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    return jobSelectChain(null);
  });
  const res = await GET(makeGetRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('GET: 正常取得 → 200 with job', async () => {
  setupAuthorize();
  const res = await GET(makeGetRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.job).toBeDefined();
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', validJob()), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正な employment_type → 400', async () => {
  setupAuthorize();
  const res = await PATCH(makeRequest('PATCH', { ...validJob(), employment_type: '不明な雇用形態' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: salary_max < salary_min → 400 (refine)', async () => {
  setupAuthorize();
  const res = await PATCH(makeRequest('PATCH', { ...validJob(), salary_min: 300000, salary_max: 200000 }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    if (callNum === 2) return jobSelectChain(MOCK_JOB);
    return jobUpdateChain(null, { message: 'DB error' });
  });
  const res = await PATCH(makeRequest('PATCH', validJob()), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 with job', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    if (callNum === 2) return jobSelectChain(MOCK_JOB);
    return jobUpdateChain({ ...MOCK_JOB, title: '更新済み求人' });
  });
  const res = await PATCH(makeRequest('PATCH', validJob()), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.job).toBeDefined();
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 求人が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    return jobSelectChain(null);
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: 正常削除 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membersChain([{ facility_id: FACILITY_UUID, role: 'owner' }]);
    if (callNum === 2) return jobSelectChain(MOCK_JOB);
    return jobDeleteChain(null);
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
});
