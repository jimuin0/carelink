/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
const rpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({ rpc })) }));
const getUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser } })) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { salonRecoveryCookieName } from '@/lib/salon-recovery';
import { businessTypes } from '@/lib/constants';
const user = '77000000-0000-4000-8000-000000000001';
const receiptId = '78000000-0000-4000-8000-000000000001';
const recoveryId = '79000000-0000-4000-8000-000000000001';
function request(body: unknown, cookie = '', raw?: string) {
  return new Request('https://localhost/api/salons/recovery', { method: 'POST', headers: { cookie }, body: raw ?? JSON.stringify(body) });
}
beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
  getUser.mockResolvedValue({ data: { user: { id: user, email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null });
  rpc.mockResolvedValue({ data: [], error: null });
});
test('CSRF and rate limit prevent auth and receipt access', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request({ action: 'list' }))).status).toBe(403);
  expect(getUser).not.toHaveBeenCalled();
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(request({ action: 'list' }))).status).toBe(429);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('unauthenticated, unconfirmed and failed auth never read receipts', async () => {
  getUser.mockResolvedValue({ data: { user: null } });
  expect((await POST(request({ action: 'list' }))).status).toBe(401);
  getUser.mockResolvedValue({ data: { user: { id: user } } });
  expect((await POST(request({ action: 'list' }))).status).toBe(403);
  getUser.mockRejectedValue(new Error('PRIVATE'));
  expect((await POST(request({ action: 'list' }))).status).toBe(503);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([{}, null, [], { action: 'list', user_id: user }, { action: 'list', email: 'synthetic@example.invalid' }, { action: 'prepare', receiptId: 'bad' }])('invalid input is rejected %#', async body => {
  expect((await POST(request(body))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('broken JSON is rejected', async () => expect((await POST(request({}, '', '{'))).status).toBe(400));
test('list has no-store and never treats failure as zero matches', async () => {
  let response = await POST(request({ action: 'list', after: receiptId }));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ state: 'ready', receipts: [], next: null });
  expect(rpc).toHaveBeenCalledWith('list_recoverable_salon_receipts', { p_user_id: user, p_after_id: receiptId });
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'REGISTRATION_ACCOUNT_UNVERIFIED' } });
  response = await POST(request({ action: 'list' })); expect(response.status).toBe(403);
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
  expect((await POST(request({ action: 'list' }))).status).toBe(500);
});
test('preparation returns a bound selector but proof only in HttpOnly cookie', async () => {
  rpc.mockImplementation(async (_name, args) => ({ data: [{ outcome: 'prepared', grant_id: args.p_grant_id,
    expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString() }], error: null }));
  const response = await POST(request({ action: 'prepare', receiptId }));
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(Object.keys(json).sort()).toEqual(['expiresAt', 'recoveryId', 'state']);
  const cookie = response.cookies.get(salonRecoveryCookieName(json.recoveryId));
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  expect(cookie!.value).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(json)).not.toContain(cookie!.value);
  expect(rpc).toHaveBeenCalledTimes(1);
});
test('denied preparation never sets a usable cookie', async () => {
  rpc.mockResolvedValue({ data: [{ outcome: 'unverified', grant_id: null, expires_at: null }], error: null });
  const response = await POST(request({ action: 'prepare', receiptId }));
  expect(response.status).toBe(403); expect(response.cookies.getAll()).toEqual([]);
});
test.each(['', 'bad'])('summary refuses missing or malformed proof %#', async proof => {
  const response = await POST(request({ action: 'summary', recoveryId }, `${salonRecoveryCookieName(recoveryId)}=${proof}`));
  expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled();
});
test('summary returns only the selected receipt, while denied proof has no fields', async () => {
  rpc.mockResolvedValue({ data: [{ outcome: 'confirmed', receipt_id: receiptId, facility_name: 'Synthetic', business_type: businessTypes[0], address: null }], error: null });
  const cookie = `${salonRecoveryCookieName(recoveryId)}=${'ab'.repeat(32)}`;
  let response = await POST(request({ action: 'summary', recoveryId }, cookie));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: 'confirmed', receiptId, name: 'Synthetic', type: businessTypes[0], address: null });
  rpc.mockResolvedValue({ data: [{ outcome: 'unverified', receipt_id: null, facility_name: null, business_type: null, address: null }], error: null });
  response = await POST(request({ action: 'summary', recoveryId }, cookie));
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ state: 'unverified' });
});
