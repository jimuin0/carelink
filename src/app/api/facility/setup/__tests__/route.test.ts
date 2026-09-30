/** @jest-environment node */
/* Atomic consumer tests replace the old multi-query compensation mocks.
 * Field mapping/role/claim/rollback proofs live in facility-setup-fixtures.sql.
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({})) }));
const getUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser } })) }));
jest.mock('@/lib/facility-setup-atomic', () => ({
  ...jest.requireActual('@/lib/facility-setup-atomic'), setupFacilityAtomically: jest.fn(),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { setupFacilityAtomically } from '@/lib/facility-setup-atomic';
import { salonIntentCookieName } from '@/lib/salon-submission-proof';
import { SALON_CLAIM_COOKIE_NAME, signSalonClaim } from '@/lib/salon-claim';
import { businessTypes } from '@/lib/constants';

const userId = '68000000-0000-4000-8000-000000000001';
const facilityId = '67000000-0000-4000-8000-000000000001';
const intentId = '6a000000-0000-4000-8000-000000000001';
const receiptId = '69000000-0000-4000-8000-000000000001';
const body = { facility_name: 'Synthetic', business_type: businessTypes[0], license_warranted: true };
const proof = 'ab'.repeat(32);
const originalSecret = process.env.ADMIN_COOKIE_SECRET;
function request(input: unknown = body, cookie = '', raw?: string) {
  return new Request('https://localhost/api/facility/setup', { method: 'POST',
    headers: { cookie }, body: raw ?? JSON.stringify(input) });
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_COOKIE_SECRET = 'synthetic-fixture-key';
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  getUser.mockResolvedValue({ data: { user: { id: userId, email: 'synthetic@example.invalid' } }, error: null });
  (setupFacilityAtomically as jest.Mock).mockResolvedValue({ state: 'created', facilityId, slug: 'synthetic' });
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_COOKIE_SECRET;
  else process.env.ADMIN_COOKIE_SECRET = originalSecret;
});
test('CSRF blocks before auth and persistence', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(getUser).not.toHaveBeenCalled(); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('rate limit blocks before auth and persistence', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(request())).status).toBe(429);
  expect(getUser).not.toHaveBeenCalled(); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('unauthenticated user cannot call setup', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('auth exception never falls back to anonymous service writes', async () => {
  getUser.mockRejectedValue(new Error('synthetic auth failure'));
  expect((await POST(request())).status).toBe(500);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([null, [], {}, { ...body, license_warranted: false }, { ...body, user_id: userId },
  { ...body, email: 'untrusted@example.invalid' }, { ...body, business_type: 'invalid' },
  { ...body, facility_name: ' ' }, { ...body, address: 123 }, { ...body, intentId: 'invalid' },
])('invalid input never writes %#', async input => {
  expect((await POST(request(input))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('broken JSON never writes', async () => {
  expect((await POST(request(body, '', '{'))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('direct onboarding is explicit and uses authenticated user only', async () => {
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ success: true, state: 'created', facilityId });
  expect(setupFacilityAtomically).toHaveBeenCalledWith({}, userId, body, { mode: 'none' });
});
test.each(['', 'bad'])('invalid present legacy cookie never falls back %#', async value => {
  const response = await POST(request(body, SALON_CLAIM_COOKIE_NAME + '=' + value));
  expect(response.status).toBe(403); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('expired but correctly signed legacy cookie never falls back', async () => {
  const expired = signSalonClaim(receiptId, 1);
  expect(expired).not.toBeNull();
  expect((await POST(request(body, SALON_CLAIM_COOKIE_NAME + '=' + expired))).status).toBe(403);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('signed legacy cookie passes its authenticated issue time and survives response loss', async () => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const cookie = SALON_CLAIM_COOKIE_NAME + '=' + signSalonClaim(receiptId, issuedAt);
  const response = await POST(request(body, cookie));
  expect(response.status).toBe(201); expect(response.headers.has('set-cookie')).toBe(false);
  expect(setupFacilityAtomically).toHaveBeenCalledWith({}, userId, body,
    { mode: 'legacy', receiptId, issuedAt: new Date(issuedAt * 1000).toISOString() });
});
test.each(['', 'bad'])('v2 requires its own proof, not legacy fallback %#', async value => {
  expect((await POST(request({ ...body, intentId }, salonIntentCookieName(intentId) + '=' + value))).status).toBe(403);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('v2 passes only selected intent capability', async () => {
  const input = { ...body, intentId };
  const response = await POST(request(input, salonIntentCookieName(intentId) + '=' + proof));
  expect(response.status).toBe(201);
  expect(setupFacilityAtomically).toHaveBeenCalledWith({}, userId, input, { mode: 'intent', intentId, proof });
  expect(JSON.stringify(await response.json())).not.toContain(proof);
});
test.each([['invalid', 400], ['unverified', 403], ['conflict', 409], ['unknown', 202]])('maps %s without claiming success', async (state, status) => {
  (setupFacilityAtomically as jest.Mock).mockResolvedValue({ state });
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect((await response.json()).success).not.toBe(true);
  expect(response.headers.has('set-cookie')).toBe(false);
});
test('replay is the same successful facility, not a new creation', async () => {
  (setupFacilityAtomically as jest.Mock).mockResolvedValue({ state: 'replay', facilityId, slug: 'synthetic' });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, state: 'replay', facilityId });
});
test('existing membership does not falsely consume selected receipt', async () => {
  (setupFacilityAtomically as jest.Mock).mockResolvedValue({ state: 'already_member', facilityId, slug: 'synthetic' });
  const response = await POST(request({ ...body, intentId }, salonIntentCookieName(intentId) + '=' + proof));
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'ALREADY_MEMBER', facilityId });
});
test('direct signup replay resolves existing membership', async () => {
  (setupFacilityAtomically as jest.Mock).mockResolvedValue({ state: 'already_member', facilityId, slug: 'synthetic' });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, state: 'already_member', facilityId });
});
