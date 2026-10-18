/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { requirePlatformAdmin } from '../platform-admin';
import { verifyPlatformSupportUser } from '../platform-support-auth';
const profile=jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({
 createServerSupabaseAuthClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-platform-user' } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ single: profile, maybeSingle: profile }) }) }),
 }),
}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();profile.mockReturnValue(new Promise(()=>{}));});
afterEach(()=>jest.useRealTimers());
test('pending platform administration does not become privilege or permanent denial',async()=>{
 const pending=requirePlatformAdmin();await jest.advanceTimersByTimeAsync(5001);const result=await pending;
 expect(result).not.toBeNull();expect((result as Response).status).toBe(503);expect((result as Response).headers.get('Cache-Control')).toBe('no-store');
});
test('pending support verification becomes unavailable, not verified or forbidden',async()=>{
 const pending=verifyPlatformSupportUser();await jest.advanceTimersByTimeAsync(5001);expect(await pending).toEqual({state:'unavailable'});
});
