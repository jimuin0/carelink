/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn().mockResolvedValue(false) }));
const rpc = jest.fn(); const profile = jest.fn(); const getUser = jest.fn();
const chain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: profile };
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({ rpc })) }));
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser }, from: jest.fn(() => chain) })) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
const actor = 'b1000000-0000-4000-8000-000000000001';
const duplicateId = 'b2000000-0000-4000-8000-000000000002';
const canonicalId = 'b2000000-0000-4000-8000-000000000001';
const facilityId = 'b5000000-0000-4000-8000-000000000001';
const input = { action: 'link', duplicateId, canonicalId, duplicateRevision: 0, canonicalRevision: 1, sameSite: true };
const request = (value: unknown = input) => new Request('https://localhost/api/admin/registrations/duplicate', { method: 'POST', body: JSON.stringify(value) });
beforeEach(() => { jest.clearAllMocks(); (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
  getUser.mockResolvedValue({ data: { user: { id: actor } } }); profile.mockResolvedValue({ data: { is_platform_admin: true }, error: null });
  rpc.mockResolvedValue({ data: { outcome: 'linked', facilityId }, error: null }); });
test('CSRF, rate limit and missing authentication prevent mutation', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 })); expect((await POST(request())).status).toBe(403);
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(true); expect((await POST(request())).status).toBe(429);
  (checkRateLimit as jest.Mock).mockResolvedValue(false); getUser.mockResolvedValue({ data: { user: null } }); expect((await POST(request())).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
test.each([null, {}, { is_platform_admin: false }, { is_platform_admin: 'true' }])('strict platform authorization %#', async data => {
  profile.mockResolvedValue({ data, error: null }); expect((await POST(request())).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
});
test('authorization provider failure is not denial or success', async () => {
  profile.mockResolvedValue({ data: { is_platform_admin: true }, error: {} }); const response = await POST(request());
  expect(response.status).toBe(500); expect(response.headers.get('cache-control')).toBe('no-store'); expect(rpc).not.toHaveBeenCalled();
});
test.each([null, {}, { ...input, sameSite: false }])('invalid input does not mutate %#', async value => {
  expect((await POST(request(value))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
});
test('malformed JSON fails closed', async () => expect((await POST(new Request('https://localhost', { method: 'POST', body: '{' }))).status).toBe(400));
test.each([['linked', 200], ['replay', 200], ['forbidden', 403], ['invalid', 400], ['conflict', 409]])('DB %s maps to %s', async (outcome, status) => {
  const data = status === 200 ? { outcome, facilityId } : { outcome }; rpc.mockResolvedValue({ data, error: null });
  const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toEqual(data);
});
test('lost mutation response returns a fixed error and never retries', async () => {
  rpc.mockRejectedValue(new Error('private provider body')); const response = await POST(request()); expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('private'); expect(rpc).toHaveBeenCalledTimes(1);
});
