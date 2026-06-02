/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/customer-profile（お客様カルテ属性・service-role）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeReq(email: string | null = 'c@example.com', facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/customer-profile');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  if (email !== null) url.searchParams.set('email', email);
  return new NextRequest(url.toString(), { method: 'GET' });
}
function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function belongsChain(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data })) };
}
function profileChain(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data, error })) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

test('レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await GET(makeReq())).status).toBe(429); });
test('未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await GET(makeReq())).status).toBe(401); });
test('facility_id なし → 401', async () => { expect((await GET(makeReq('c@example.com', null))).status).toBe(401); });
test('facility_id 不正 → 401', async () => { expect((await GET(makeReq('c@example.com', 'bad'))).status).toBe(401); });
test('非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await GET(makeReq())).status).toBe(401); });
test('email なし → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await GET(makeReq(null))).status).toBe(400); });
test('email 長すぎ → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await GET(makeReq('a'.repeat(255)))).status).toBe(400); });
test('当該施設の顧客でない → profile:null', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(belongsChain(null));
  const r = await GET(makeReq());
  expect(r.status).toBe(200);
  expect((await r.json()).profile).toBeNull();
});
test('profiles 取得失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(belongsChain({ id: 'b1' })).mockReturnValueOnce(profileChain(null, { message: 'e' }));
  expect((await GET(makeReq())).status).toBe(500);
});
test('正常 → 200 profile', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(belongsChain({ id: 'b1' })).mockReturnValueOnce(profileChain({ birth_date: '1990-01-01', gender: 'female', prefecture: '東京都', city: '渋谷区' }));
  const r = await GET(makeReq());
  expect(r.status).toBe(200);
  expect((await r.json()).profile.gender).toBe('female');
});
test('profile が存在しない顧客 → profile:null', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(belongsChain({ id: 'b1' })).mockReturnValueOnce(profileChain(null));
  const r = await GET(makeReq());
  expect(r.status).toBe(200);
  expect((await r.json()).profile).toBeNull();
});
