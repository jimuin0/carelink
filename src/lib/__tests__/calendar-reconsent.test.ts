/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { calendarGoogleJSON, verifiedCalendarRefreshToken } from '../calendar-reconsent';

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); });

test('body and headers are bounded, including fetch implementations that ignore abort', async () => {
  jest.useFakeTimers(); (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const pending=calendarGoogleJSON('https://example.invalid',{});
  const outcome=expect(pending).rejects.toThrow('GOOGLE_CALENDAR_PROVIDER_TIMEOUT');
  await jest.advanceTimersByTimeAsync(10_000);await outcome;
  expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
});
test('a stalled body also times out', async () => {
  jest.useFakeTimers();(fetch as jest.Mock).mockResolvedValue({ok:true,json:()=>new Promise(()=>{})});
  const outcome=expect(calendarGoogleJSON('https://example.invalid',{})).rejects.toThrow('GOOGLE_CALENDAR_PROVIDER_TIMEOUT');
  await jest.advanceTimersByTimeAsync(10_000);await outcome;
});
test('provider rejection does not read a credential-bearing error body', async () => {
  const json=jest.fn();(fetch as jest.Mock).mockResolvedValue({ok:false,json});
  await expect(calendarGoogleJSON('https://example.invalid',{})).rejects.toThrow('GOOGLE_CALENDAR_PROVIDER_UNAVAILABLE');expect(json).not.toHaveBeenCalled();
});
test('successful body clears timer and releases its controller', async () => {
  jest.useFakeTimers();(fetch as jest.Mock).mockResolvedValue(new Response('{"ok":true}'));
  await expect(calendarGoogleJSON('https://example.invalid',{})).resolves.toEqual({ok:true});expect(jest.getTimerCount()).toBe(0);
});
test.each(['headers','body'])('rejected %s request clears its deadline', async phase => {
  jest.useFakeTimers(); const error=new Error('synthetic provider failure');
  (fetch as jest.Mock).mockImplementation(()=>phase==='headers'?Promise.reject(error):Promise.resolve({ok:true,json:()=>Promise.reject(error)}));
  await expect(calendarGoogleJSON('https://example.invalid',{})).rejects.toBe(error);expect(jest.getTimerCount()).toBe(0);
});
function provider({rotate=false,mismatch=false,identity='owner@example.invalid',grant={access_token:'old-access',expires_in:3600}}={}) {
  (fetch as jest.Mock).mockImplementation(async (url: string, options: RequestInit) => {
    if(url.includes('oauth2.googleapis.com'))return new Response(JSON.stringify({...grant,...(rotate?{refresh_token:'rotated-refresh'}:{})}));
    const old=new Headers(options.headers).get('Authorization')==='Bearer old-access';
    return new Response(JSON.stringify({id:mismatch&&old?'other@example.invalid':identity}));
  });
}
test.each([false,true])('only matching grant identity permits refresh reuse, rotation=%s',async rotate=>{
  provider({rotate});await expect(verifiedCalendarRefreshToken('new-access','existing-refresh','client','secret')).resolves.toBe(rotate?'rotated-refresh':'existing-refresh');
  const [url,init]=(fetch as jest.Mock).mock.calls[0];expect(url).toBe('https://oauth2.googleapis.com/token');expect(init.body.get('grant_type')).toBe('refresh_token');expect(init.body.get('refresh_token')).toBe('existing-refresh');
  expect((fetch as jest.Mock).mock.calls.slice(1).map(x=>x[0])).toEqual(Array(2).fill('https://www.googleapis.com/calendar/v3/calendars/primary'));
});
test('different Google accounts cannot produce a mixed credential',async()=>{
  provider({mismatch:true});await expect(verifiedCalendarRefreshToken('new-access','existing-refresh','client','secret')).rejects.toThrow('GOOGLE_CALENDAR_ACCOUNT_CHANGED');
});
test.each(['primary','',null])('unconfirmed primary %p cannot authorize reuse',async identity=>{
  provider({identity:identity as string});await expect(verifiedCalendarRefreshToken('new-access','existing-refresh','client','secret')).rejects.toThrow();
});
test.each([{access_token:'',expires_in:3600},{access_token:'old-access',expires_in:0},{access_token:'old-access',expires_in:3600,refresh_token:''}])('malformed durable grant cannot authorize reuse',async grant=>{
  provider({grant});await expect(verifiedCalendarRefreshToken('new-access','existing-refresh','client','secret')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
