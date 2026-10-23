import {
  hasLineSignupConsent,
  isCurrentLineSignupConsent,
  LINE_AUTHORIZE_URL,
  LINE_SIGNUP_CONSENT_AGREED,
  LINE_SIGNUP_CONSENT_MARKER,
  lineOAuthCallbackUrl,
  lineOAuthOrigin,
} from '../line-oauth';
import { REGISTRATION_TERMS_SHA256 } from '../registration-consent';

const ORIGINAL_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

test('the consent marker names the current Terms/Privacy edition', () => {
  expect(LINE_SIGNUP_CONSENT_MARKER).toBe(`terms-${REGISTRATION_TERMS_SHA256}`);
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

// 同意は登録画面のフォーム送信（CSRF 検証済み POST）でだけ受け取る。値は固定の 'agreed'。
// 公開された規約版マーカーを送っても同意にはならない（PR#793 レビュー P2）。
test.each([
  [{ intent: 'signup', consent: LINE_SIGNUP_CONSENT_AGREED }, true],
  [{}, false],
  [{ intent: 'signup' }, false],
  [{ intent: 'signup', consent: '' }, false],
  [{ consent: LINE_SIGNUP_CONSENT_AGREED }, false],
  [{ intent: 'login', consent: LINE_SIGNUP_CONSENT_AGREED }, false],
  [{ intent: 'signup', consent: LINE_SIGNUP_CONSENT_MARKER }, false],
])('hasLineSignupConsent(%p) → %p', (fields, expected) => {
  expect(hasLineSignupConsent(form(fields))).toBe(expected);
});

test('a file named like the agreed value is not consent', () => {
  const f = form({ intent: 'signup' });
  f.set('consent', new Blob([LINE_SIGNUP_CONSENT_AGREED]), LINE_SIGNUP_CONSENT_AGREED);
  expect(hasLineSignupConsent(f)).toBe(false);
});

test('the LINE authorize endpoint is the origin allowed by CSP form-action', () => {
  expect(new URL(LINE_AUTHORIZE_URL).origin).toBe('https://access.line.me');
});

test.each([
  [LINE_SIGNUP_CONSENT_MARKER, true],
  [undefined, false],
  ['', false],
  ['terms-old', false],
])('isCurrentLineSignupConsent(%p) → %p', (value, expected) => {
  expect(isCurrentLineSignupConsent(value)).toBe(expected);
});

test.each([
  [undefined, 'https://carelink-jp.com'],
  ['https://www.carelink-jp.com/', 'https://carelink-jp.com'],
  ['http://localhost:3000', 'http://localhost:3000'],
])('public origin for NEXT_PUBLIC_BASE_URL=%p is %p (read at call time)', (raw, expected) => {
  if (raw === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = raw;
  expect(lineOAuthOrigin()).toBe(expected);
  expect(lineOAuthCallbackUrl()).toBe(`${expected}/api/auth/line/callback`);
});
