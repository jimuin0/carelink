/** @jest-environment node */
import Anthropic, { APIConnectionTimeoutError } from '@anthropic-ai/sdk';

test('real SDK does not automatically repeat an upstream failure when maxRetries=0', async () => {
  const fetcher=jest.fn(async()=>new Response(JSON.stringify({type:'error',error:{type:'api_error',message:'synthetic'}}),{status:500,headers:{'Content-Type':'application/json'}}));
  const client=new Anthropic({apiKey:'synthetic-local-only',timeout:10000,maxRetries:0,fetch:fetcher});
  await expect(client.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:1,messages:[{role:'user',content:'synthetic'}]})).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('real SDK aborts its pending provider request at deadline with one attempt', async () => {
  jest.useFakeTimers();
  try {
    const fetcher=jest.fn((_url:unknown,options?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      options!.signal!.addEventListener('abort',()=>{ const error=new Error('synthetic timed out'); error.name='AbortError'; reject(error); },{once:true});
    }));
    const client=new Anthropic({apiKey:'synthetic-local-only',timeout:10000,maxRetries:0,fetch:fetcher});
    const result=client.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:1,messages:[{role:'user',content:'synthetic'}]})
      .then(()=>null,error=>error);
    await jest.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(APIConnectionTimeoutError); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {jest.useRealTimers();}
});
