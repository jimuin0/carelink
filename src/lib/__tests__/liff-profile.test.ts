/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/line', () => ({ verifyLineAccessToken: jest.fn() }));
import { verifyLineAccessToken } from '@/lib/line';
import { fetchVerifiedLiffProfile, LIFF_PROFILE_TIMEOUT_MS } from '../liff-profile';

beforeEach(() => {
  jest.clearAllMocks(); (verifyLineAccessToken as jest.Mock).mockResolvedValue({ ok: true });
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'U_verified' })));
});
afterEach(() => jest.useRealTimers());
test('audience refusal never fetches a profile', async () => {
  (verifyLineAccessToken as jest.Mock).mockResolvedValue({ ok: false });
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ ok: false, status: 401 });
  expect(fetch).not.toHaveBeenCalled();
});
test.each([[401,401],[403,401],[429,503],[500,503],[404,502],[400,502]])('upstream %i maps to %i without granting identity', async (upstream,status) => {
  global.fetch = jest.fn().mockResolvedValue(new Response('', { status: upstream }));
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ ok: false,status });
});
test.each([null,1,{}, { userId: 1 },{ userId: '' },{ userId: 'U with spaces' },{ userId: 'x'.repeat(129) }])('invalid provider payload %p never grants identity', async value => {
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(value)));
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ ok: false,status: 502 });
});
test('malformed body is a provider failure', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('{'));
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ ok: false,status: 502 });
});
test('transport failure is unavailable', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('secret provider body'));
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ ok: false,status: 503 });
});
test.each([{userId:'U_verified'}, {userId:'U_verified',displayName:1,pictureUrl:1}, {userId:'U_verified',displayName:'Name',pictureUrl:'https://example.invalid/avatar'}])('valid server identity and optional typed metadata: %p', async value => {
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(value)));
  const result = await fetchVerifiedLiffProfile('token');
  expect(result).toMatchObject({ok:true,lineUserId:'U_verified'});
  expect(fetch).toHaveBeenCalledWith('https://api.line.me/v2/profile', expect.objectContaining({ headers: {Authorization:'Bearer token'},signal:expect.any(AbortSignal) }));
});
test.each(['fetch','body'])('10 second deadline includes %s and ignores a late valid identity', async phase => {
  jest.useFakeTimers();
  let release!: (value:any)=>void;
  const waiting = new Promise<any>(r => { release=r; });
  global.fetch = jest.fn().mockReturnValue(phase==='fetch' ? waiting : Promise.resolve({ok:true,json:()=>waiting}));
  const pending = fetchVerifiedLiffProfile('token');
  await jest.advanceTimersByTimeAsync(LIFF_PROFILE_TIMEOUT_MS);
  expect(await pending).toMatchObject({ok:false,status:503});
  expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  release(phase==='fetch' ? new Response(JSON.stringify({userId:'U_late'})) : {userId:'U_late'});
  await Promise.resolve();
  expect(await pending).toMatchObject({ok:false,status:503});
});
test('a response completing at the deadline cannot win authority', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockImplementation(async () => { jest.setSystemTime(Date.now()+LIFF_PROFILE_TIMEOUT_MS); return new Response(JSON.stringify({userId:'U_late'})); });
  expect(await fetchVerifiedLiffProfile('token')).toMatchObject({ok:false,status:503});
});
