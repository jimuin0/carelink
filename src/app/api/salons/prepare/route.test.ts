/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn(() => ({})) }));
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('@/lib/salon-submission-intent', () => ({ prepareSalonIntent: jest.fn(), readSalonIntentStatus: jest.fn() }));
jest.mock('@/lib/salon-registration-summary', () => ({ readSalonRegistrationSummary: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { NextResponse } from 'next/server';
import { POST as prepare } from './route';
import { POST as status } from '../status/route';
import { POST as summary } from '../summary/route';
import { readSalonRegistrationSummary } from '@/lib/salon-registration-summary';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { prepareSalonIntent, readSalonIntentStatus } from '@/lib/salon-submission-intent';
import { salonIntentCookieName } from '@/lib/salon-submission-proof';
import { createServiceRoleClient } from '@/lib/supabase-server';

const intent = '64000000-0000-4000-8000-000000000001';
const other = '64000000-0000-4000-8000-000000000002';
const proof = '01'.repeat(32);
const prepared = { state: 'prepared', intentId: intent, proof, expiresAt: '2026-09-27T00:00:00.000Z' };
const originalEnv = { NODE_ENV: process.env.NODE_ENV, flag: process.env.SALON_REGISTRATION_V2_ENABLED, captcha: process.env.RECAPTCHA_SECRET_KEY };

function request(body: unknown, cookie?: string, raw?: string) {
  return new Request('https://localhost/api/salons/fixture', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: raw ?? JSON.stringify(body),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, { NODE_ENV: 'production', SALON_REGISTRATION_V2_ENABLED: 'true', RECAPTCHA_SECRET_KEY: 'fixture-only' });
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });
  (prepareSalonIntent as jest.Mock).mockResolvedValue(prepared);
  (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state: 'uncommitted' });
  (readSalonRegistrationSummary as jest.Mock).mockResolvedValue({ state: 'uncommitted' });
});
afterAll(() => {
  Object.assign(process.env, { NODE_ENV: originalEnv.NODE_ENV });
  for (const [name, value] of [['SALON_REGISTRATION_V2_ENABLED', originalEnv.flag], ['RECAPTCHA_SECRET_KEY', originalEnv.captcha]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});

test.each([prepare, status, summary])('inactive v2 never touches persistence %#', async route => {
  delete process.env.SALON_REGISTRATION_V2_ENABLED;
  const response = await route(request({}));
  expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});

test.each([prepare, status, summary])('CSRF and rate limit apply before the handler %#', async route => {
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'fixture' }, { status: 403 }));
  expect((await route(request({}))).status).toBe(403);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await route(request({}))).status).toBe(429);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});

test.each([prepare, status, summary])('malformed JSON does not reach persistence %#', async route => {
  expect((await route(request({}, undefined, '{'))).status).toBe(400);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});

test.each([{ recaptcha_token: 12 }, { email: 'forbidden@example.invalid' }])('prepare rejects unexpected values %#', async body => {
  expect((await prepare(request(body))).status).toBe(400);
});
test('prepare rejects absent or failed captcha before creating an intent', async () => {
  expect((await prepare(request({}))).status).toBe(403);
  expect(verifyRecaptcha).not.toHaveBeenCalled();
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: false });
  expect((await prepare(request({ recaptcha_token: 'fixture-token' }))).status).toBe(403);
  expect(prepareSalonIntent).not.toHaveBeenCalled();
});

test.each(['production', 'test'])('prepare keeps proof out of JSON and configures capability cookie in %s', async environment => {
  Object.assign(process.env, { NODE_ENV: environment });
  const response = await prepare(request({ recaptcha_token: 'fixture-token' }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ state: 'prepared', intentId: intent, expiresAt: prepared.expiresAt });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.cookies.get(salonIntentCookieName(intent)!)).toEqual(expect.objectContaining({
    value: proof, httpOnly: true, secure: environment === 'production', sameSite: 'lax', path: '/', maxAge: 259200,
  }));
  expect(verifyRecaptcha).toHaveBeenCalledWith('fixture-token', 'salons', 0.4);
});

test('five independent tabs receive distinct intent cookies without replacing others', async () => {
  delete process.env.RECAPTCHA_SECRET_KEY;
  const names = new Set<string>();
  for (let n = 1; n <= 5; n++) {
    const id = `64000000-0000-4000-8000-00000000000${n}`;
    (prepareSalonIntent as jest.Mock).mockResolvedValue({ ...prepared, intentId: id });
    const response = await prepare(request({}));
    names.add(response.cookies.getAll()[0].name);
  }
  expect(names.size).toBe(5); expect(verifyRecaptcha).not.toHaveBeenCalled();
});

test.each([{ state: 'unavailable' }, { ...prepared, intentId: 'bad-id' }])('unconfirmed prepare returns no cookie or capability %#', async result => {
  (prepareSalonIntent as jest.Mock).mockResolvedValue(result);
  const response = await prepare(request({ recaptcha_token: 'fixture-token' }));
  expect(response.status).toBe(503); expect(response.cookies.getAll()).toEqual([]);
  expect(await response.json()).toEqual({ code: 'PREPARATION_UNAVAILABLE' });
});

test.each([{}, { intentId: 'bad' }, { intentId: intent, proof }])('status rejects malformed or JSON capability %#', async body => {
  expect((await status(request(body))).status).toBe(400);
  expect(readSalonIntentStatus).not.toHaveBeenCalled();
});
test.each([undefined, `${salonIntentCookieName(intent)}=bad`, `${salonIntentCookieName(other)}=${proof}`])(
  'status requires the selected intent cookie %#', async cookie => {
    const response = await status(request({ intentId: intent }, cookie));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ state: 'unverified' });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

test.each([
  [{ state: 'uncommitted' }, 200], [{ state: 'committed', receiptId: other }, 200],
  [{ state: 'expired' }, 200], [{ state: 'unverified' }, 403], [{ state: 'unavailable' }, 503],
])('status returns only the capability-checked result %#', async (result, expected) => {
  (readSalonIntentStatus as jest.Mock).mockResolvedValue(result);
  const response = await status(request({ intentId: intent }, `${salonIntentCookieName(intent)}=${proof}`));
  expect(response.status).toBe(expected); expect(await response.json()).toEqual(result);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(readSalonIntentStatus).toHaveBeenCalledWith({}, intent, proof);
});

test.each([{}, { intentId: 'bad' }, { intentId: intent, receiptId: other }, { intentId: intent, proof }])('summary rejects arbitrary selectors and JSON capabilities %#', async body => {
  expect((await summary(request(body))).status).toBe(400);
  expect(readSalonRegistrationSummary).not.toHaveBeenCalled();
});
test.each([undefined, `${salonIntentCookieName(intent)}=bad`, `${salonIntentCookieName(other)}=${proof}`])('summary requires the selected cookie before private access %#', async cookie => {
  expect((await summary(request({ intentId: intent }, cookie))).status).toBe(403);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test.each([
  [{ state: 'uncommitted' }, 200], [{ state: 'expired' }, 200],
  [{ state: 'unverified' }, 403], [{ state: 'unavailable' }, 503],
  [{ state: 'confirmed', receiptId: other, name: 'Synthetic', type: 'ヘアサロン', area: '' }, 200],
])('summary returns only the independently authorized projection %#', async (result, expected) => {
  (readSalonRegistrationSummary as jest.Mock).mockResolvedValue(result);
  const response = await summary(request({ intentId: intent }, `${salonIntentCookieName(intent)}=${proof}`));
  expect(response.status).toBe(expected); expect(await response.json()).toEqual(result);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(readSalonRegistrationSummary).toHaveBeenCalledWith({}, intent, proof);
});
