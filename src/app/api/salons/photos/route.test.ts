/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({})) }));
jest.mock('@/lib/salon-photo-preparation', () => ({ prepareSalonPhoto: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from './route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { prepareSalonPhoto } from '@/lib/salon-photo-preparation';
import { salonIntentCookieName } from '@/lib/salon-submission-proof';

const intentId = '64000000-0000-4000-8000-000000000001';
const other = '64000000-0000-4000-8000-000000000002';
const input = { intentId, selectionId: other, slot: 0, mimeType: 'image/png', byteSize: 10 };
const proof = 'ab'.repeat(32);
const cookie = `${salonIntentCookieName(intentId)}=${proof}`;
const flag = process.env.SALON_REGISTRATION_V2_ENABLED;
function request(body: unknown = input, value: string = cookie, raw?: string) {
  return new Request('https://localhost/api/salons/photos', { method: 'POST', headers: { cookie: value }, body: raw ?? JSON.stringify(body) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.SALON_REGISTRATION_V2_ENABLED = 'true';
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});
afterAll(() => { if (flag === undefined) delete process.env.SALON_REGISTRATION_V2_ENABLED; else process.env.SALON_REGISTRATION_V2_ENABLED = flag; });
test('disabled route never creates a service client', async () => {
  delete process.env.SALON_REGISTRATION_V2_ENABLED;
  const res = await POST(request());
  expect(res.status).toBe(404); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('CSRF and rate limit block before RPC/signing', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(request())).status).toBe(429);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([{}, { ...input, path: 'other' }, { ...input, byteSize: 0 }])('invalid input blocks persistence %#', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(prepareSalonPhoto).not.toHaveBeenCalled();
});
test('broken JSON blocks persistence', async () => {
  expect((await POST(request(input, cookie, '{'))).status).toBe(400); expect(prepareSalonPhoto).not.toHaveBeenCalled();
});
test.each(['', `${salonIntentCookieName(intentId)}=bad`, `${salonIntentCookieName(other)}=${proof}`])('only the selected intent cookie is accepted %#', async value => {
  expect((await POST(request(input, value))).status).toBe(403); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([
  ['invalid', 400], ['unverified', 403], ['unavailable', 503], ['expired', 410],
  ['committed', 409], ['conflict', 409], ['limit', 409], ['uploaded', 200], ['upload', 200],
])('maps %s explicitly without leaking proof', async (state, status) => {
  (prepareSalonPhoto as jest.Mock).mockResolvedValue({ state });
  const res = await POST(request());
  expect(res.status).toBe(status); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({ state });
  expect(prepareSalonPhoto).toHaveBeenCalledWith({}, input, proof);
});
