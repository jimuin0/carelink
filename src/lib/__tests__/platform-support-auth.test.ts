/** @jest-environment node */
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn() }));
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from '../supabase-server-auth';
import { verifyPlatformSupportUser } from '../platform-support-auth';
const getUser = jest.fn(), single = jest.fn(), from = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'synthetic' } }, error: null });
  single.mockResolvedValue({ data: { is_platform_admin: true, display_name: 'Synthetic operator' }, error: null });
  from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
  (createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({ auth: { getUser }, from });
});
test('fresh literal privilege authorizes and retains a bounded display name', async () => {
  expect(await verifyPlatformSupportUser()).toEqual({ state: 'verified', user: { id: 'synthetic' }, name: 'Synthetic operator' });
  expect(single).toHaveBeenCalledTimes(1);
});
test.each([undefined, null, 1])('non-string display name uses null: %s', async name => {
  single.mockResolvedValue({ data: { is_platform_admin: true, display_name: name }, error: null });
  expect(await verifyPlatformSupportUser()).toMatchObject({ state: 'verified', name: null });
});
test.each([null, {}, { is_platform_admin: false }, { is_platform_admin: 'true' }])('absent/false/non-boolean privilege cannot authorize: %j', async data => {
  single.mockResolvedValue({ data, error: null });
  expect(await verifyPlatformSupportUser()).toEqual({ state: 'forbidden' });
});
test('true privilege with a lookup error is not authoritative', async () => {
  single.mockResolvedValue({ data: { is_platform_admin: true }, error: { message: 'synthetic-private' } });
  expect(await verifyPlatformSupportUser()).toEqual({ state: 'unavailable' });
});
test.each(['anonymous', 'unavailable'])('Auth %s never reads privileges', async mode => {
  getUser.mockResolvedValue({ data: { user: null }, error: mode === 'anonymous' ? null : new AuthRetryableFetchError('synthetic', 503) });
  expect((await verifyPlatformSupportUser()).state).toBe(mode === 'anonymous' ? 'unauthenticated' : 'unavailable');
  expect(from).not.toHaveBeenCalled();
});
test('client/privilege exceptions become availability failures without raw diagnostic', async () => {
  (createServerSupabaseAuthClient as jest.Mock).mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await verifyPlatformSupportUser()).toEqual({ state: 'unavailable' });
  single.mockRejectedValue(new Error('synthetic-private'));
  expect(await verifyPlatformSupportUser()).toEqual({ state: 'unavailable' });
});
