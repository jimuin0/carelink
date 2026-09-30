/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));
jest.mock('@/lib/admin-inquiry-list', () => ({ readAdminInquiryList: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { readAdminInquiryList } from '@/lib/admin-inquiry-list';

const userId = '33333333-3333-4333-8333-333333333333';
const id = '11111111-1111-4111-8111-111111111111';
const time = '2026-09-26T12:30:40.123456+00:00';
const maybeSingle = jest.fn();
function request(query = '') {
  return new NextRequest(`http://localhost/api/admin/inquiries${query}`);
}
function profileChain() {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnValue({ maybeSingle }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockAnonFrom.mockReturnValue(profileChain());
  maybeSingle.mockResolvedValue({ data: { is_platform_admin: true }, error: null });
  jest.mocked(readAdminInquiryList).mockResolvedValue({ state: 'confirmed', contacts: [], nextCursor: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

test('requires an authenticated platform admin and does not read through browser/RLS client', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  const anonymous = await GET(request());
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
  expect(readAdminInquiryList).not.toHaveBeenCalled();

  maybeSingle.mockResolvedValueOnce({ data: { is_platform_admin: false }, error: null });
  const forbidden = await GET(request());
  expect(forbidden.status).toBe(403);
  expect(readAdminInquiryList).not.toHaveBeenCalled();
});

test('profile absence is forbidden; profile lookup failure is not an empty list', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect((await GET(request())).status).toBe(403);
  maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
  const failed = await GET(request());
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain('private');
  expect(readAdminInquiryList).not.toHaveBeenCalled();
});

test('rejects unknown keys, duplicate filters, and malformed cursors', async () => {
  for (const query of [
    '?unexpected=1',
    '?status=open&status=closed',
    '?cursor=bad',
    '?status=invalid',
    `?cursor=${encodeURIComponent('{}')}`,
  ]) {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(readAdminInquiryList).not.toHaveBeenCalled();
});

test('passes strict status and microsecond cursor to service-role list, with no-store response', async () => {
  const cursor = { id, createdAt: time };
  const response = await GET(request(`?status=waiting&cursor=${encodeURIComponent(JSON.stringify(cursor))}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ contacts: [], nextCursor: null });
  expect(readAdminInquiryList).toHaveBeenCalledWith({ from: mockAdminFrom }, { status: 'waiting', cursor });
});

test('rate limiting and list failures remain explicit and private', async () => {
  jest.mocked(checkRateLimit).mockResolvedValueOnce(true);
  expect((await GET(request())).status).toBe(429);
  expect(readAdminInquiryList).not.toHaveBeenCalled();

  jest.mocked(readAdminInquiryList).mockResolvedValueOnce({ state: 'invalid' });
  expect((await GET(request())).status).toBe(400);
  jest.mocked(readAdminInquiryList).mockResolvedValueOnce({ state: 'unavailable', reason: 'database_error' });
  const unavailable = await GET(request());
  expect(unavailable.status).toBe(500);
  expect(await unavailable.text()).not.toContain('申込なし');
  expect(unavailable.headers.get('Cache-Control')).toBe('no-store');
});
