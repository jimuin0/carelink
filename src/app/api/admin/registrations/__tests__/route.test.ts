/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
const mockGetUser = jest.fn(); const mockAnonFrom = jest.fn(); const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));
jest.mock('@/lib/registration-list', () => ({ readRegistrationList: jest.fn() }));
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { readRegistrationList } from '@/lib/registration-list';
const userId = '74000000-0000-4000-8000-000000000001';
const maybeSingle = jest.fn();
function request(method = 'GET', body = '{}', origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/admin/registrations', {
    method, headers: { origin, host: 'localhost', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body } : {}),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockAnonFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  maybeSingle.mockResolvedValue({ data: { is_platform_admin: true }, error: null });
  jest.mocked(readRegistrationList).mockResolvedValue({ state: 'confirmed', salons: [], nextCursor: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});
test.each([GET, POST])('anonymous requests fail closed and no-store %#', async handler => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  const response = await handler(request(handler === POST ? 'POST' : 'GET'));
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(readRegistrationList).not.toHaveBeenCalled();
});
test.each([false, null, 'true', 1, undefined])('non-boolean-admin %p is forbidden', async is_platform_admin => {
  maybeSingle.mockResolvedValue({ data: { is_platform_admin }, error: null });
  expect((await GET(request())).status).toBe(403);
  expect(readRegistrationList).not.toHaveBeenCalled();
});
test('absent profile is forbidden', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  expect((await GET(request())).status).toBe(403);
});
test.each(['error', 'throw'])('authorization %s does not use service role or disclose private details', async mode => {
  if (mode === 'error') maybeSingle.mockResolvedValue({ data: { is_platform_admin: true }, error: { message: 'PRIVATE' } });
  else maybeSingle.mockRejectedValue(new Error('PRIVATE'));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('PRIVATE');
  expect(readRegistrationList).not.toHaveBeenCalled();
});
test.each(['GET', 'POST'])('rate limit on %s remains private and prevents list access', async method => {
  jest.mocked(checkRateLimit).mockResolvedValue(true);
  const response = await (method === 'GET' ? GET : POST)(request(method));
  expect(response.status).toBe(429);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(readRegistrationList).not.toHaveBeenCalled();
});
test('cross-origin search is rejected', async () => {
  expect((await POST(request('POST', '{}', 'https://attacker.invalid'))).status).toBe(403);
  expect(readRegistrationList).not.toHaveBeenCalled();
});
test('GET is backwards-compatible first-page listing and POST carries search only in body', async () => {
  const input = { field: 'email', query: 'synthetic@example.invalid', status: 'all', cursor: null };
  for (const [handler, req, value] of [[GET, request(), {}], [POST, request('POST', JSON.stringify(input)), input]] as const) {
    const response = await handler(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ salons: [], nextCursor: null });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(readRegistrationList).toHaveBeenLastCalledWith({ from: mockAdminFrom }, value);
  }
});
test('invalid search and broken JSON are not successful empty results', async () => {
  jest.mocked(readRegistrationList).mockResolvedValue({ state: 'invalid' });
  expect((await POST(request('POST', '{broken'))).status).toBe(400);
  expect(readRegistrationList).toHaveBeenLastCalledWith({ from: mockAdminFrom }, null);
});
test.each(['unavailable', 'throw'])('list %s yields explicit unavailable result', async mode => {
  if (mode === 'throw') jest.mocked(readRegistrationList).mockRejectedValue(new Error('PRIVATE'));
  else jest.mocked(readRegistrationList).mockResolvedValue({ state: 'unavailable' });
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.text();
  expect(body).toContain('申込なしとは判定できません');
  expect(body).not.toContain('PRIVATE');
});
test('rate limiter preserves trusted-proxy IP selection and budget', async () => {
  await GET(new NextRequest('http://localhost/api/admin/registrations', { headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' } }));
  expect(jest.mocked(checkRateLimit).mock.calls[0].slice(1, 4)).toEqual(['192.168.1.1', 30, 60_000]);
});
