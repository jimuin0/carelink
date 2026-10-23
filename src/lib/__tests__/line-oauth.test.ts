import {
  hasLineSignupConsent,
  isCurrentLineSignupConsent,
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

test.each([
  [`intent=signup&consent=${LINE_SIGNUP_CONSENT_MARKER}`, true],
  ['', false],
  ['intent=signup', false],
  [`consent=${LINE_SIGNUP_CONSENT_MARKER}`, false],
  [`intent=login&consent=${LINE_SIGNUP_CONSENT_MARKER}`, false],
  ['intent=signup&consent=terms-old', false],
])('hasLineSignupConsent(%p) → %p', (query, expected) => {
  expect(hasLineSignupConsent(new URLSearchParams(query))).toBe(expected);
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
