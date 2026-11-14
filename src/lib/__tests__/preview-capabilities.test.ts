/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  isPreviewRestricted,
  isPublicReadOnlyPreview,
  PREVIEW_READ_ONLY_MESSAGE,
  previewRestrictedResponse,
  previewStaleAuthCookies,
} from '../preview-capabilities';

const original = process.env;
afterEach(() => { process.env = original; });

function setEnv(environment: string | undefined, key: string | undefined) {
  process.env = { ...original };
  if (environment === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = environment;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
}

test.each([
  ['preview', undefined, true],
  ['preview', 'isolated-preview-key', false],
  ['production', undefined, false],
  ['development', undefined, false],
  [undefined, undefined, false],
])('private capability is omitted only for unconfigured Preview (%s)', (environment, key, expected) => {
  setEnv(environment, key);
  expect(isPublicReadOnlyPreview()).toBe(expected);
});

describe('public read-only Preview refuses account areas and writes', () => {
  beforeEach(() => setEnv('preview', undefined));

  test.each([
    ['GET', '/auth/login'],
    ['GET', '/auth/signup'],
    ['GET', '/auth/callback'],
    ['GET', '/auth/reset-password'],
    ['GET', '/auth'],
    ['GET', '/mypage'],
    ['GET', '/mypage/bookings'],
    ['GET', '/admin/onboarding'],
    ['GET', '/liff/booking'],
    ['GET', '/api/auth/line/callback'],
    ['POST', '/api/booking'],
    ['post', '/api/contact'],
    ['PATCH', '/api/profile'],
    ['DELETE', '/api/favorites'],
    ['POST', '/search'],
  ])('%s %s is restricted', (method, path) => {
    expect(isPreviewRestricted(method, path)).toBe(true);
  });

  test.each([
    ['GET', '/'],
    ['GET', '/search'],
    ['HEAD', '/facility/example'],
    ['OPTIONS', '/api/booking'],
    ['GET', '/api/health'],
    ['GET', '/authors'],
    ['GET', '/administration-guide'],
    ['GET', '/register'],
  ])('%s %s stays readable', (method, path) => {
    expect(isPreviewRestricted(method, path)).toBe(false);
  });
});

test.each([
  ['production', undefined],
  ['preview', 'isolated-preview-key'],
  [undefined, undefined],
])('nothing is restricted outside the public Preview (%s)', (environment, key) => {
  setEnv(environment, key);
  expect(isPreviewRestricted('POST', '/api/booking')).toBe(false);
  expect(isPreviewRestricted('GET', '/auth/login')).toBe(false);
});

test('page refusal is an uncached, unindexed notice without scripts', async () => {
  for (const method of ['GET', 'head']) {
    const res = previewRestrictedResponse(method);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const body = await res.text();
    expect(body).toContain(PREVIEW_READ_ONLY_MESSAGE);
    expect(body).not.toContain('<script');
  }
});

test('write refusal is JSON with a stable code', async () => {
  const res = previewRestrictedResponse('POST');
  expect(res.status).toBe(403);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({ error: PREVIEW_READ_ONLY_MESSAGE, code: 'preview_read_only' });
});

describe('session cookies left on a public Preview origin', () => {
  const names = ['sb-abcdefghijklmnopqrst-auth-token', 'sb-abcdefghijklmnopqrst-auth-token.0',
    'sb-abcdefghijklmnopqrst-auth-token.1', 'sb-abcdefghijklmnopqrst-auth-token-code-verifier',
    'cookie_consent', '_cm_mbr_0123456789abcdef', 'sb-abcdefghijklmnopqrst-other'];

  test('only Supabase auth cookies are selected in the public Preview', () => {
    setEnv('preview', undefined);
    expect(previewStaleAuthCookies(names)).toEqual(names.slice(0, 4));
  });

  test.each([['production', undefined], ['preview', 'isolated-preview-key']])(
    'nothing is expired outside the public Preview (%s)', (environment, key) => {
      setEnv(environment, key);
      expect(previewStaleAuthCookies(names)).toEqual([]);
    });

  test.each(['GET', 'POST'])('the %s refusal expires them', (method) => {
    const res = previewRestrictedResponse(method, ['sb-x-auth-token', 'sb-x-auth-token.0']);
    expect(res.headers.getSetCookie()).toEqual([
      'sb-x-auth-token=; Path=/; Max-Age=0; SameSite=Lax; Secure',
      'sb-x-auth-token.0=; Path=/; Max-Age=0; SameSite=Lax; Secure',
    ]);
  });

  test('no cookie header is added when there is nothing to expire', () => {
    expect(previewRestrictedResponse('GET').headers.getSetCookie()).toEqual([]);
  });
});
