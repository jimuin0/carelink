/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readAuthorization, AuthorizationReadTimeoutError, AUTHORIZATION_READ_TIMEOUT_MS } from '../authorization-read';
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
test('a completed SELECT keeps its exact receipt and clears the deadline',async()=>{
 const receipt={data:{role:'owner'},error:null};const abortSignal=jest.fn().mockReturnValue(Promise.resolve(receipt));
 const value=await readAuthorization(Object.assign(Promise.resolve(receipt),{abortSignal}));
 expect(value).toBe(receipt);expect(abortSignal).toHaveBeenCalledTimes(1);expect(abortSignal.mock.calls[0][0].aborted).toBe(false);expect(jest.getTimerCount()).toBe(0);
});
test('Promise-like test transports remain bounded without an abort hook',async()=>{
 await expect(readAuthorization(Promise.resolve('ready'))).resolves.toBe('ready');expect(jest.getTimerCount()).toBe(0);
});
test('a normal database rejection is preserved and not retried',async()=>{
 const failure={code:'08006',message:'synthetic-private'};await expect(readAuthorization(Promise.reject(failure))).rejects.toBe(failure);expect(jest.getTimerCount()).toBe(0);
});
test('a synchronously failing abort hook is cleaned up',async()=>{
 const failure=new Error('synthetic');const query=Object.assign(Promise.resolve(null),{abortSignal:()=>{throw failure;}});
 await expect(readAuthorization(query)).rejects.toBe(failure);expect(jest.getTimerCount()).toBe(0);
});
test.each([true,false])('a pending SELECT expires even when abort cooperation=%p',async cooperative=>{
 let signal!:AbortSignal;let attempts=0;
 const query=Object.assign(new Promise<never>(()=>{}),{abortSignal:(value:AbortSignal)=>{signal=value;attempts++;return new Promise<never>((_resolve,reject)=>{if(cooperative)value.addEventListener('abort',()=>reject(new Error('synthetic-private-transport')));});}});
 const result=readAuthorization(query).catch(e=>e);
 await jest.advanceTimersByTimeAsync(AUTHORIZATION_READ_TIMEOUT_MS-1);expect(signal.aborted).toBe(false);
 await jest.advanceTimersByTimeAsync(1);const error=await result;expect(error).toBeInstanceOf(AuthorizationReadTimeoutError);expect(error.message).toBe('AUTHORIZATION_READ_TIMEOUT');expect(signal.aborted).toBe(true);expect(attempts).toBe(1);expect(jest.getTimerCount()).toBe(0);
});
test('a receipt resumed at the deadline is not accepted as a fresh authority observation',async()=>{
 const clock=jest.spyOn(Date,'now').mockReturnValueOnce(0).mockReturnValueOnce(AUTHORIZATION_READ_TIMEOUT_MS);
 await expect(readAuthorization(Promise.resolve({data:{role:'owner'}}))).rejects.toBeInstanceOf(AuthorizationReadTimeoutError);
 clock.mockRestore();expect(jest.getTimerCount()).toBe(0);
});
