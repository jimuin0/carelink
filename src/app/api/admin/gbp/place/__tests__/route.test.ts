/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/gbp/place
 * Key assertions:
 *   - Non-member → 403
 *   - GET: facility not found → 404
 *   - GET: external fetchPlaceDetails mocked
 *   - POST: saves gbp_place_id to facility_profiles
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/gbp', () => ({
  fetchPlaceDetails: jest.fn(() => Promise.resolve(null)),
  calculateGbpScore: jest.fn(() => ({ score: 80, items: [] })),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { fetchPlaceDetails } from '@/lib/gbp';

// Membership check: limit(1).single()
function membershipSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// facility_profiles: select().eq().single()
function facilityProfileSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// upsert chain (gbp_audit_cache)
function upsertChain(error: unknown = null) {
  return {
    upsert: jest.fn(() => Promise.resolve({ error })),
  };
}

// update().eq() → Promise
function updateEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

const MEMBER_DATA = { facility_id: FACILITY_UUID };
const FACILITY_DATA = {
  gbp_place_id: null,
  name: 'テスト施設',
  description: null,
  phone: null,
  website_url: null,
  business_hours: null,
  main_photo_url: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(null);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(429);
});

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(401);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: 施設が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return facilityProfileSingle(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(404);
});

test('GET: gbp_place_id なし → 200 with placeData null', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    if (callNum === 2) return facilityProfileSingle(FACILITY_DATA);
    // upsert/update calls don't happen since placeData is null
    return upsertChain(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.placeData).toBeNull();
  expect(json.audit).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(429);
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEq({ message: 'DB error' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(500);
});

test('POST: 正常保存 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEq(null);
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});
