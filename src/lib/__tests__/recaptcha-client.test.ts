/** @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom */
const SITE = 'test-site-key';
beforeEach(() => { jest.resetModules(); process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = SITE; });
afterEach(() => {
  jest.useRealTimers(); jest.restoreAllMocks(); delete window.grecaptcha;
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  document.querySelectorAll('script[src*="/recaptcha/api.js"]').forEach(node => node.remove());
});
const sdk = (execute = jest.fn().mockResolvedValue('token')) => ({
  ready: jest.fn((done: () => void) => done()), execute,
});
const script = () => document.querySelector('script[src*="/recaptcha/api.js"]') as HTMLScriptElement;
const loaded = (node: HTMLScriptElement) => node.dispatchEvent(new Event('load'));

test('unconfigured development returns null without creating a script', async () => {
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();expect(script()).toBeNull();
});
test('existing SDK receives each action and creates distinct action tokens', async () => {
  const execute = jest.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two');window.grecaptcha = sdk(execute);
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBe('one');expect(await getRecaptchaToken('contact')).toBe('two');
  expect(execute.mock.calls).toEqual([[SITE,{action:'review'}],[SITE,{action:'contact'}]]);expect(script()).toBeNull();
});
test('simultaneous requests share one loader and retain independent actions', async () => {
  const { getRecaptchaToken } = await import('../recaptcha-client');
  const one = getRecaptchaToken('review'),two = getRecaptchaToken('contact');
  expect(document.querySelectorAll('script[src*="/recaptcha/api.js"]')).toHaveLength(1);
  window.grecaptcha=sdk(jest.fn().mockImplementation((_key,{action})=>Promise.resolve(action)));
  loaded(script());expect(await Promise.all([one,two])).toEqual(['review','contact']);
});
test.each(['error','empty'])('failed loader %s is removed and retry can succeed', async failure => {
  const { getRecaptchaToken,RecaptchaClientError } = await import('../recaptcha-client');
  const pending=getRecaptchaToken('review'),checked=expect(pending).rejects.toBeInstanceOf(RecaptchaClientError);
  const old=script();old.dispatchEvent(new Event(failure==='error'?'error':'load'));await checked;
  expect(script()).toBeNull();
  const retry=getRecaptchaToken('review');window.grecaptcha=sdk();loaded(script());
  expect(await retry).toBe('token');
});
test('unsettled loader times out; an old onload cannot resolve the fresh retry', async () => {
  jest.useFakeTimers();const {getRecaptchaToken}=await import('../recaptcha-client');
  const first=getRecaptchaToken('review'),checked=expect(first).rejects.toThrow('入力はこの画面に保持');
  const old=script(),lateLoad=old.onload!;await jest.advanceTimersByTimeAsync(8000);await checked;
  expect(old.isConnected).toBe(false);
  const retry=getRecaptchaToken('contact');const fresh=script();let resolved=false;
  void retry.then(()=>{resolved=true;});window.grecaptcha=sdk();lateLoad.call(old,new Event('load'));
  await Promise.resolve();expect(resolved).toBe(false);
  loaded(fresh);expect(await retry).toBe('token');
});
test('unsettled ready times out without execute; a late callback cannot start it', async () => {
  jest.useFakeTimers();const callbacks: (()=>void)[]=[];
  const api=sdk();api.ready.mockImplementation(done=>{callbacks.push(done);});window.grecaptcha=api;
  const {getRecaptchaToken}=await import('../recaptcha-client');
  const first=getRecaptchaToken('review'),checked=expect(first).rejects.toThrow('入力はこの画面に保持');
  await jest.advanceTimersByTimeAsync(5000);await checked;expect(api.execute).not.toHaveBeenCalled();
  callbacks[0]();await Promise.resolve();expect(api.execute).not.toHaveBeenCalled();
  const retry=getRecaptchaToken('contact');await Promise.resolve();await Promise.resolve();
  callbacks[1]();expect(await retry).toBe('token');expect(api.execute).toHaveBeenCalledTimes(1);
});
test('unsettled execute times out and its late result cannot replace a retry token', async () => {
  jest.useFakeTimers();let finish!: (value:string)=>void;
  const execute=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce('fresh-token');
  window.grecaptcha=sdk(execute);const {getRecaptchaToken}=await import('../recaptcha-client');
  const first=getRecaptchaToken('review'),checked=expect(first).rejects.toThrow('入力はこの画面に保持');
  await jest.advanceTimersByTimeAsync(5000);await checked;
  const retry=getRecaptchaToken('review');expect(await retry).toBe('fresh-token');
  finish('old-token');await Promise.resolve();expect(execute).toHaveBeenCalledTimes(2);
});
test('late execution rejection after timeout is handled without invalidating a retry',async()=>{
 jest.useFakeTimers();let rejectLate!: (error:Error)=>void;
 const execute=jest.fn().mockImplementationOnce(()=>new Promise((_ok,reject)=>{rejectLate=reject;})).mockResolvedValueOnce('fresh');
 window.grecaptcha=sdk(execute);const {getRecaptchaToken}=await import('../recaptcha-client');
 const pending=getRecaptchaToken('review'),checked=expect(pending).rejects.toThrow('送信前の確認');
 await jest.advanceTimersByTimeAsync(5000);await checked;
 expect(await getRecaptchaToken('review')).toBe('fresh');rejectLate(new Error('late private detail'));await Promise.resolve();
});
test('simultaneous SDK-loss failures reset only their own cache generation',async()=>{
 const api=sdk();api.ready.mockImplementationOnce(done=>{delete window.grecaptcha;done();});
 window.grecaptcha=api;const {getRecaptchaToken}=await import('../recaptcha-client');
 const one=getRecaptchaToken('review');const two=getRecaptchaToken('contact');const three=getRecaptchaToken('salons');
 const result=await Promise.allSettled([one,two,three]);
 expect(result.map(row=>row.status)).toEqual(['fulfilled','rejected','rejected']);
 const retry=getRecaptchaToken('salons');window.grecaptcha=sdk();loaded(script());expect(await retry).toBe('token');
});
test.each(['ready','execute-throw','execute-reject'])('%s exception is redacted and retry works', async failure => {
  const api=sdk();window.grecaptcha=api;
  if(failure==='ready')api.ready.mockImplementationOnce(()=>{throw new Error('private-provider-detail');});
  if(failure==='execute-throw')api.execute.mockImplementationOnce(()=>{throw new Error('private-provider-detail');});
  if(failure==='execute-reject')api.execute.mockRejectedValueOnce(new Error('private-provider-detail'));
  const {getRecaptchaToken}=await import('../recaptcha-client');
  await expect(getRecaptchaToken('review')).rejects.toThrow('送信前の確認');
  expect(await getRecaptchaToken('review')).toBe('token');
});
test.each(['','   ',null,42])('empty/malformed token %j rejects rather than posting without protection',async token=>{
  window.grecaptcha=sdk(jest.fn().mockResolvedValue(token));const {getRecaptchaToken}=await import('../recaptcha-client');
  await expect(getRecaptchaToken('review')).rejects.toThrow('送信前の確認');
});
test('cached loader cannot authorize a request when the SDK disappeared', async()=>{
  window.grecaptcha=sdk();const {getRecaptchaToken}=await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBe('token');delete window.grecaptcha;
  await expect(getRecaptchaToken('review')).rejects.toThrow('送信前の確認');
  const retry=getRecaptchaToken('review');window.grecaptcha=sdk();loaded(script());
  expect(await retry).toBe('token');
});
test('DOM append failure is redacted even when cleanup also fails',async()=>{
  jest.spyOn(document.head,'appendChild').mockImplementation(()=>{throw new Error('private');});
  jest.spyOn(HTMLScriptElement.prototype,'remove').mockImplementation(()=>{throw new Error('private');});
  const {getRecaptchaToken}=await import('../recaptcha-client');
  await expect(getRecaptchaToken('review')).rejects.toThrow('送信前の確認');
});
