/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient, AuthApiError, AuthSessionMissingError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js';
import { classifyAuthVerification, verifyAuthUser } from '../auth-verification';

const result = (error: unknown, user: unknown = null) => ({ data: { user }, error });

test.each([null, undefined, false, 1, '', {}, { error: null }, { data: null },
  { data: false }, { data: {} }, { data: { user: undefined }, error: null }, result(null, false),
  result(null, {}), result(null, { id: '' }), result(null, { id: 123 })])(
  'malformed result is not authenticated or evidence of logout: %j', input => {
    expect(classifyAuthVerification(input)).toEqual({ state: 'unavailable' });
  });
test.each([null, undefined])('authoritative null user with no error is unauthenticated: %s', error => {
  expect(classifyAuthVerification(result(error))).toEqual({ state: 'unauthenticated' });
});
test('only a verified user grants access (also accepts SDK-compatible adapters without error field)', () => {
  const user = { id: 'synthetic-user' };
  expect(classifyAuthVerification(result(null, user))).toEqual({ state: 'verified', user });
  expect(classifyAuthVerification({ data: { user } })).toEqual({ state: 'verified', user });
});
test.each(['bad_jwt', 'session_not_found', 'session_expired', 'refresh_token_not_found',
  'refresh_token_already_used', 'user_not_found'])('known invalid session %s remains unauthenticated', code => {
  for (const status of [400, 401, 403]) {
    expect(classifyAuthVerification(result(new AuthApiError('do not log', status, code))))
      .toEqual({ state: 'unauthenticated' });
  }
});
test('SDK missing-session error remains unauthenticated', () => {
  expect(classifyAuthVerification(result(new AuthSessionMissingError()))).toEqual({ state: 'unauthenticated' });
});
test.each([new AuthSessionMissingError(), new AuthApiError('invalid', 401, 'bad_jwt')])(
  'error plus user is inconsistent even for known invalid-session errors', error => {
    expect(classifyAuthVerification(result(error, { id: 'synthetic-user' }))).toEqual({ state: 'unavailable' });
  });
test.each([
  new AuthRetryableFetchError('secret-free synthetic failure', 0),
  new AuthRetryableFetchError('upstream unavailable', 503),
  new AuthApiError('retry', 429, 'over_request_rate_limit'),
  new AuthApiError('timeout', 408, 'request_timeout'),
  new AuthApiError('unexpected', 400, 'unexpected_failure'),
  new AuthApiError('unexpected', 401),
  new AuthApiError('bad_jwt but upstream failed', 503, 'bad_jwt'),
  new AuthUnknownError('unknown', new Error('synthetic')),
  new Error('synthetic credentials must never be forwarded'),
  { code: 'bad_jwt', status: 401 },
])('failed verification never grants access or proves logout: %s', error => {
  for (const user of [null, { id: 'synthetic-user' }]) {
    expect(classifyAuthVerification(result(error, user))).toEqual({ state: 'unavailable' });
  }
});
test('inconsistent missing-session status is not authoritative', () => {
  const error = new AuthSessionMissingError(); error.status = 503;
  expect(classifyAuthVerification(result(error))).toEqual({ state: 'unavailable' });
});
test('verifier retains method receiver, handles returned SDK errors and thrown errors', async () => {
  const auth = { value: 'synthetic-user', async getUser() { return result(null, { id: this.value }); } };
  expect(await verifyAuthUser(auth)).toEqual({ state: 'verified', user: { id: 'synthetic-user' } });
  expect(await verifyAuthUser({ getUser: async () => result(new AuthRetryableFetchError('failed', 0)) }))
    .toEqual({ state: 'unavailable' });
  expect(await verifyAuthUser({ getUser: async () => { throw new Error('synthetic'); } }))
    .toEqual({ state: 'unavailable' });
});
test.each([503, 429, 401])('actual SDK fetch pipeline returns errors rather than throwing (%s)', async status => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ code: status === 401 ? 'bad_jwt' : 'unexpected_failure', message: 'synthetic' }),
    { status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } }));
  const client = createClient('http://127.0.0.1:1', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher },
  });
  // Injected fetch prevents any real network. Explicit JWT bypasses local-session
  // setup, so this verifies the SDK HTTP error contract, not refresh-cookie I/O.
  const response = await client.auth.getUser('synthetic-jwt');
  expect(response.data.user).toBeNull(); expect(response.error).not.toBeNull();
  expect(classifyAuthVerification(response).state).toBe(status === 401 ? 'unauthenticated' : 'unavailable');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
