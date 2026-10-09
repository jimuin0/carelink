/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { collectNewsletterRecipients, inspectNewsletterOperation, publishNewsletterOperation } from '../newsletter-send';
jest.mock('@/lib/newsletter-unsub', () => ({ newsletterUnsubUrl: jest.fn((email: string) => `https://carelink-jp.com/unsubscribe?n=opaque-${email}`) }));
jest.mock('@/lib/email-from', () => ({ newsletterFromEnv: () => 'CareLink <newsletter@carelink-jp.com>' }));
import { newsletterUnsubUrl } from '../newsletter-unsub';
const id = 'e1000000-0000-4000-8000-000000000001';
const actor = 'e1000000-0000-4000-8000-000000000002';
const receipt = { operation_id: 'e1000000-0000-4000-8000-000000000003', campaign_id: id, total: 1, queued: 1, unconfirmed: 0, accepted: 0, suppressed: 0, failed: 0 };
function client(results: {data: unknown;error: unknown}[] = [], rpcResult: unknown = receipt) {
  const from = jest.fn(() => {
    const result = results.shift() ?? {data: [],error: null};
    const chain: Record<string, unknown> = {};
    for (const method of ['select','or','eq','order','range','in']) chain[method] = jest.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve,reject);
    return chain;
  });
  const rpc = jest.fn().mockResolvedValue({data:rpcResult,error:null});
  return { from, rpc };
}
const ok = (data: unknown) => ({data,error:null});
beforeEach(() => jest.clearAllMocks());
test('subscription/owner merge, canonical case/whitespace, both suppression sources', async () => {
  const c = client([ok([{email:' A@Example.com '},{email:'x@gmail.com'},{email:'x+tag@gmail.com'},{email:'stop@example.com'}]),ok([{user_id:actor}]),ok([{email:'a@example.com'},{email:'owner@example.com'}]),ok([{email:'STOP@example.com'}]),ok([{email:'OWNER@example.com'}])]);
  expect(await collectNewsletterRecipients(c as never,'owner_monthly')).toEqual(['a@example.com','x+tag@gmail.com','x@gmail.com']);
});
test.each([0,1,2,3,4])('error with partial data at stage %s stops publication', async stage => {
  const c=client([ok([{email:'a@example.com'}]),ok([{user_id:actor}]),ok([{email:'owner@example.com'}]),ok([]),ok([])].map((r,i)=>i===stage?{...r,error:{message:'dependency'}}:r));
  await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'owner_monthly',updated_at:'2026-10-09T00:00:00Z'},'2026-10-09T00:00:00Z')).rejects.toMatchObject({status:503});
  expect(c.rpc).not.toHaveBeenCalled(); expect(newsletterUnsubUrl).not.toHaveBeenCalled();
});
test.each([null,{},[{email:42}],[{email:'bad-mail'}]])('missing/malformed input never produces envelope: %p', async data => {
 const c=client([ok(data),ok([]),ok([])]);
 await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'user_digest',updated_at:'2026-10-09T00:00:00Z'},'2026-10-09T00:00:00Z')).rejects.toMatchObject({status:503});
 expect(c.rpc).not.toHaveBeenCalled();
});
test('second owners profile chunk failure cannot publish first 500 only', async () => {
 const owners=Array.from({length:501},(_,i)=>({user_id:`e1000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`}));
 const c=client([ok([]),ok(owners),ok([{email:'first@example.com'}]),{data:[{email:'last@example.com'}],error:{message:'failed'}}]);
 await expect(collectNewsletterRecipients(c as never,'owner_monthly')).rejects.toMatchObject({status:503});
});
test('1000 subscriber boundary is paged and suppression mandatory when no candidates', async () => {
 const c=client([ok(Array.from({length:1000},(_,i)=>({email:`u${i}@example.com`}))),ok([{email:'last@example.com'}]),ok([]),ok([])]);
 expect(await collectNewsletterRecipients(c as never,'user_digest')).toHaveLength(1001); expect(c.from).toHaveBeenCalledTimes(4);
 const empty=client([ok([]),{data:[],error:{message:'suppression unavailable'}}]);
 await expect(collectNewsletterRecipients(empty as never,'user_digest')).rejects.toMatchObject({status:503});
});
test('publication snapshots links once and RPC uses observed revision, never claims directly', async () => {
 const c=client([ok([{email:'a@example.com'}]),ok([]),ok([])]);
 await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'user_digest',updated_at:'2026-10-09T00:00:00Z'},'2026-10-09T00:00:00Z')).resolves.toEqual(receipt);
 expect(c.rpc).toHaveBeenCalledWith('publish_newsletter_send_operation',expect.objectContaining({p_expected_revision:'2026-10-09T00:00:00Z',p_expected_emails:['a@example.com']}));
 expect(newsletterUnsubUrl).toHaveBeenCalledTimes(1);
});
test.each([undefined,'bad','2026-10-08T00:00:00Z'])('old/stale consumer revision %p stops before reads', async revision => {
 const c=client(); await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'user_digest',updated_at:'2026-10-09T00:00:00Z'},revision)).rejects.toMatchObject({status:409}); expect(c.from).not.toHaveBeenCalled();
});
test('no recipients is a visible pre-publication rejection', async () => {
 const c=client([ok([]),ok([]),ok([])]);await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'user_digest',updated_at:'2026-10-09T00:00:00Z'},'2026-10-09T00:00:00Z')).rejects.toMatchObject({status:409});expect(c.rpc).not.toHaveBeenCalled();
});
test.each([['42501',403],['40001',409],['23514',409],['PGRST202',503]])('RPC %s refuses phantom receipt',async(code,status)=>{const c=client();c.rpc.mockResolvedValue({data:receipt,error:{code}});await expect(inspectNewsletterOperation(c as never,actor,id)).rejects.toMatchObject({status});});
test.each([undefined,[],{...receipt,total:2},{...receipt,campaign_id:actor}])('malformed/replayed other-campaign receipt fails: %p',async data=>{const c=client([],data); if(data===undefined)c.rpc.mockResolvedValue({data,error:null}); await expect(inspectNewsletterOperation(c as never,actor,id)).rejects.toMatchObject({status:503});});
test('inspect replay reads no recipients or link secrets; null is definite no-operation',async()=>{const c=client();expect(await inspectNewsletterOperation(c as never,actor,id)).toEqual(receipt);expect(c.from).not.toHaveBeenCalled();expect(newsletterUnsubUrl).not.toHaveBeenCalled();c.rpc.mockResolvedValue({data:null,error:null});expect(await inspectNewsletterOperation(c as never,actor,id)).toBeNull();});

test('nullable/blank addresses are skipped, and owner audience may be empty', async()=>{const c=client([ok([{email:null},{email:' '}]),ok([]),ok([{email:null}]),ok([{email:null}])]);expect(await collectNewsletterRecipients(c as never,'owner_monthly')).toEqual([]);});
test.each([undefined,'network',{}])('unstructured/missing RPC error fails safely: %p',async error=>{const c=client();c.rpc.mockResolvedValue({data:receipt,error});await expect(inspectNewsletterOperation(c as never,actor,id)).rejects.toMatchObject({status:503});});
test('maxRows full pages cannot silently truncate audience',async()=>{const full=ok(Array.from({length:1000},(_,i)=>({email:`u${i}@example.com`})));const c=client(Array.from({length:100},()=>full));await expect(collectNewsletterRecipients(c as never,'user_digest')).rejects.toMatchObject({status:503});expect(c.from).toHaveBeenCalledTimes(100);});
test('publication RPC data plus concurrent audience error cannot return success',async()=>{const c=client([ok([{email:'a@example.com'}]),ok([]),ok([])]);c.rpc.mockResolvedValue({data:receipt,error:{code:'40001'}});await expect(publishNewsletterOperation(c as never,actor,{id,campaign_type:'user_digest',updated_at:'2026-10-09T00:00:00Z'},'2026-10-09T00:00:00Z')).rejects.toMatchObject({status:409});});
