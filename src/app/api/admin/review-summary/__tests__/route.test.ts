/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/review-summary
 * Key assertions:
 *   - facility_id required
 *   - ANTHROPIC_API_KEY missing → 503
 *   - Platform-admin OR facility member (owner/admin)
 *   - < 3 reviews → { summary: null }
 *   - Anthropic API failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

// Self-contained factory: createFn is captured inside and exposed as static prop
jest.mock('@anthropic-ai/sdk', () => {
  const createFn = jest.fn();
  const MockAnthropicClass: any = jest.fn(() => ({ messages: { create: createFn } }));
  MockAnthropicClass._mockCreate = createFn;
  return { __esModule: true, default: MockAnthropicClass };
});

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import Anthropic from '@anthropic-ai/sdk';

function getMockCreate(): jest.Mock {
  return (Anthropic as any)._mockCreate;
}

function makeRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/review-summary');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function memberMaybeSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function reviewsChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

const SAMPLE_REVIEWS = [
  { rating: 5, comment: '良いです', rating_skill: 5, rating_service: 5, rating_atmosphere: 5 },
  { rating: 4, comment: 'まあまあ', rating_skill: 4, rating_service: 4, rating_atmosphere: 4 },
  { rating: 5, comment: '最高でした', rating_skill: 5, rating_service: 5, rating_atmosphere: 5 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  getMockCreate().mockResolvedValue({ content: [{ text: 'この施設は素晴らしいです。' }] });
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest());
  expect(res.status).toBe(429);
});

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeRequest(null));
  expect(res.status).toBe(400);
});

test('GET: ANTHROPIC_API_KEY 未設定 → 503', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await GET(makeRequest());
  expect(res.status).toBe(503);
});

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
});

test('GET: 一般ユーザー（施設メンバーでもない）→ 403', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return profileSingle(false);
    return memberMaybeSingle(null);
  });
  const res = await GET(makeRequest());
  expect(res.status).toBe(403);
});

test('GET: 口コミが 2 件 → summary: null', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(reviewsChain([SAMPLE_REVIEWS[0], SAMPLE_REVIEWS[1]]));
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.summary).toBeNull();
  expect(json.reason).toBeDefined();
});

test('GET: 施設メンバー → 3件以上で 200 with summary', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return profileSingle(false);
    return memberMaybeSingle({ facility_id: FACILITY_UUID });
  });
  mockAdminFrom.mockReturnValue(reviewsChain(SAMPLE_REVIEWS));
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.summary).toBe('この施設は素晴らしいです。');
});

test('GET: プラットフォーム管理者 + 3件以上 → 200 with summary', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(reviewsChain(SAMPLE_REVIEWS));
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.summary).toBeDefined();
});

test('GET: Anthropic API 失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(reviewsChain(SAMPLE_REVIEWS));
  getMockCreate().mockRejectedValue(new Error('API error'));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
});
