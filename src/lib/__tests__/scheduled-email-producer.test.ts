/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {queueScheduledEmail,reviewEmailCandidates,digestEmailCandidates,scheduledLegacyHolds} from '../scheduled-email-producer';
const id='11111111-1111-4111-8111-111111111111';const uid='22222222-2222-4222-8222-222222222222';
const review={email:'synthetic@example.invalid',customerName:'<customer>',facilityName:'<clinic>',facilitySlug:'clinic'};
const digest={email:review.email,userName:null,unsubscribeToken:'a'.repeat(64),facilities:[{name:'<clinic>',slug:'clinic',newCoupons:1,hasNewMenus:true}]};
const rpc=jest.fn();const db={rpc} as any;
test.each(['review_request','favorites_digest'] as const)('observes legacy %s holds without resetting them',async kind=>{
 rpc.mockReset().mockResolvedValue({data:{review_request:2,favorites_digest:3},error:null});expect(await scheduledLegacyHolds(db,kind)).toBe(kind==='review_request'?2:3);
});
test.each([{data:null,error:null},{data:{review_request:0,favorites_digest:0},error:{message:'unavailable'}}])('observation failure cannot become zero holds %#',async result=>{
 rpc.mockReset().mockResolvedValue(result);await expect(scheduledLegacyHolds(db,'review_request')).rejects.toThrow('observation unavailable');
});
beforeEach(()=>{rpc.mockReset().mockResolvedValueOnce({data:[{state:'reserved',operation_id:id,snapshot:review}],error:null})
 .mockResolvedValueOnce({data:[{id,status:'pending',created:true}],error:null});});
test.each(['review_request','favorites_digest'] as const)('source-owned %s publication uses one stable operation and no provider call',async kind=>{
 rpc.mockReset().mockResolvedValueOnce({data:[{state:'reserved',operation_id:id,snapshot:kind==='review_request'?review:digest}],error:null})
  .mockResolvedValueOnce({data:[{id,status:'pending',created:true}],error:null});
 expect(await queueScheduledEmail(db,kind,uid)).toBe('queued');const env=rpc.mock.calls[1][1].p_envelope;
 expect(env.to).toBe(review.email);expect(env.html).toContain('&lt;clinic&gt;');expect(rpc.mock.calls[1][1].p_operation_id).toBe(id);
});
test('digest keeps captured name/token',async()=>{
 rpc.mockReset().mockResolvedValueOnce({data:[{state:'reserved',operation_id:id,snapshot:{...digest,userName:'<person>'}}],error:null})
 .mockResolvedValueOnce({data:[{id,status:'pending',created:true}],error:null});
 expect(await queueScheduledEmail(db,'favorites_digest',uid)).toBe('queued');expect(rpc.mock.calls[1][1].p_envelope.html).toContain('&lt;person&gt;');
});
test.each(['accepted','not_eligible','legacy_uncertain'])('reservation %s cannot republish',async state=>{
 rpc.mockReset().mockResolvedValue({data:[{state,operation_id:null,snapshot:null}],error:null});
 expect(await queueScheduledEmail(db,'review_request',uid)).toBe(state==='not_eligible'?'skipped':state);expect(rpc).toHaveBeenCalledTimes(1);
});
test.each(['pending','processing','success','failed','uncertain','superseded'])('existing publication %s preserves identity',async status=>{
 rpc.mockReset().mockResolvedValueOnce({data:[{state:'reserved',operation_id:id,snapshot:review}],error:null})
 .mockResolvedValueOnce({data:[{id,status,created:false}],error:null});
 expect(await queueScheduledEmail(db,'review_request',uid)).toBe(status==='success'?'accepted':status==='superseded'?'skipped':['pending','processing'].includes(status)?'existing':status);
});
test.each([{data:null,error:null},{data:[],error:null},{data:[{state:'reserved',operation_id:id,snapshot:review}],error:{message:'lost response'}}])('unconfirmed reserve cannot publish %#',async result=>{
 rpc.mockReset().mockResolvedValue(result);await expect(queueScheduledEmail(db,'review_request',uid)).rejects.toThrow('reservation not confirmed');expect(rpc).toHaveBeenCalledTimes(1);
});
test('missing identity cannot generate a replacement',async()=>{
 rpc.mockReset().mockResolvedValue({data:[{state:'reserved',operation_id:null,snapshot:review}],error:null});await expect(queueScheduledEmail(db,'review_request',uid)).rejects.toThrow('identity missing');
});
test.each([{data:null,error:null},{data:[],error:null},{data:[{id:uid,status:'pending',created:true}],error:null},{data:[{id,status:'pending',created:true}],error:{message:'unknown'}}])('unconfirmed publication is not sent %#',async result=>{
 rpc.mockReset().mockResolvedValueOnce({data:[{state:'reserved',operation_id:id,snapshot:review}],error:null}).mockResolvedValueOnce(result);
 await expect(queueScheduledEmail(db,'review_request',uid)).rejects.toThrow('publication not confirmed');
});
test.each([false,true])('review keyset pages through the backend 1000-row cap, more=%s',async full=>{
 const page=Array.from({length:1000},(_,i)=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,updated_at:'2026-10-11T00:00:00Z'}));
 rpc.mockReset().mockResolvedValueOnce({data:page,error:null}).mockResolvedValueOnce({data:full?page:[{id,updated_at:'2026-10-12T00:00:00Z'}],error:null});
 const result=await reviewEmailCandidates(db);expect(result.ids.length).toBe(full?2000:1001);expect(result.more).toBe(full);expect(rpc.mock.calls[1][1].p_after_id).toBe(page[999].id);
});
test.each(['review','digest'])('candidate lookup error or malformed page stops before publication: %s',async kind=>{
 for(const result of [{data:null,error:null},{data:[],error:{message:'unavailable'}}]) {
  rpc.mockReset().mockResolvedValue(result);await expect(kind==='review'?reviewEmailCandidates(db):digestEmailCandidates(db)).rejects.toThrow('candidates unavailable');
 }
});
test('digest reaches later recipients without an all-Auth-users scan',async()=>{
 const page=Array.from({length:1000},(_,i)=>({user_id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 rpc.mockReset().mockResolvedValueOnce({data:page,error:null}).mockResolvedValueOnce({data:[{user_id:uid}],error:null});
 expect((await digestEmailCandidates(db)).length).toBe(1001);expect(rpc.mock.calls[1][1].p_after).toBe(page[999].user_id);
});
test('digest complete-source safety cap fails BEFORE dispatch',async()=>{
 const page=Array.from({length:1000},()=>({user_id:uid}));rpc.mockReset().mockResolvedValue({data:page,error:null});
 await expect(digestEmailCandidates(db)).rejects.toThrow('safety limit');expect(rpc).toHaveBeenCalledTimes(100);
});
