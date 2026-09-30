/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({})) }));
jest.mock('@/lib/salon-submission-commit', () => ({
  ...jest.requireActual('@/lib/salon-submission-commit'), commitSalonSubmission: jest.fn(),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { NextResponse } from 'next/server';
import { POST } from './route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { commitSalonSubmission } from '@/lib/salon-submission-commit';
import { salonIntentCookieName } from '@/lib/salon-submission-proof';
import { businessTypes } from '@/lib/constants';

const intentId = '64000000-0000-4000-8000-000000000001';
const other = '64000000-0000-4000-8000-000000000002';
const input = { intentId, photoIds: [], registration: { facility_name: 'Synthetic', business_type: businessTypes[0],
  representative_name: 'Synthetic', contact_name: 'Synthetic', email: 'synthetic@example.invalid', phone: '09012345678', source: 'register' } };
const proof = 'ab'.repeat(32);
const cookie = `${salonIntentCookieName(intentId)}=${proof}`;
const flag = process.env.SALON_REGISTRATION_V2_ENABLED;
function request(body: unknown = input, value: string = cookie, raw?: string) {
  return new Request('https://localhost/api/salons/commit', { method: 'POST', headers: { cookie: value }, body: raw ?? JSON.stringify(body) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.SALON_REGISTRATION_V2_ENABLED = 'true';
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false);
});
afterAll(() => { if (flag === undefined) delete process.env.SALON_REGISTRATION_V2_ENABLED; else process.env.SALON_REGISTRATION_V2_ENABLED = flag; });
test('disabled route never creates a service client', async () => {
  delete process.env.SALON_REGISTRATION_V2_ENABLED;
  const res = await POST(request()); expect(res.status).toBe(404); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('CSRF and rate limit block before commit', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(request())).status).toBe(429); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([{}, { ...input, url: 'other' }, { ...input, photoIds: ['bad'] }])('invalid input blocks persistence %#', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(commitSalonSubmission).not.toHaveBeenCalled();
});
test('field errors are fixed messages, not submitted PII/provider text', async () => {
  const res = await POST(request({ ...input, registration: { ...input.registration, email: 'PRIVATE-INVALID', phone: 'PRIVATE' } }));
  const body = await res.json(); expect(res.status).toBe(400);
  expect(body.fieldErrors).toEqual({ email: 'メールアドレスを確認してください（254文字以内）', phone: '電話番号を確認してください' });
  expect(JSON.stringify(body)).not.toContain('PRIVATE');
});
test('broken JSON blocks persistence', async () => {
  expect((await POST(request(input, cookie, '{'))).status).toBe(400); expect(commitSalonSubmission).not.toHaveBeenCalled();
});
test.each(['', `${salonIntentCookieName(intentId)}=bad`, `${salonIntentCookieName(other)}=${proof}`])('only the selected intent cookie is accepted %#', async value => {
  expect((await POST(request(input, value))).status).toBe(403); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([
  ['invalid', 400], ['unverified', 403], ['unavailable', 503], ['expired', 410],
  ['committed', 201], ['conflict', 409], ['photo_unverified', 409], ['unknown', 202], ['replay', 200],
])('maps %s explicitly without leaking proof or issuing a legacy cookie', async (state, status) => {
  const result = state === 'committed' || state === 'replay' ? { state, receiptId: other } : { state };
  (commitSalonSubmission as jest.Mock).mockResolvedValue(result);
  const res = await POST(request()); expect(res.status).toBe(status); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.has('set-cookie')).toBe(false); expect(await res.json()).toEqual(result);
  expect(commitSalonSubmission).toHaveBeenCalledWith({}, input, proof);
});
