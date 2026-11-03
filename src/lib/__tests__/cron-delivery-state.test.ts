/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { countReportDeliveryHolds, countFollowupDeliveryHolds, markReportDeliveryAccepted, markFollowupDelivery, releaseFollowupDelivery } from '../cron-delivery-state';
import type { createServiceRoleClient } from '../supabase-server';
const id='68000000-0000-4000-8000-000000000001';
function counts(facility: unknown, registration: unknown = facility) {
 const make=(value:unknown)=>{const q={select:jest.fn(),eq:jest.fn(),lt:jest.fn()};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.lt.mockResolvedValue(value);return q;};
 const first=make(facility),second=make(registration);const db={from:jest.fn((table:string)=>table==='salons'?second:first)} as unknown as ReturnType<typeof createServiceRoleClient>;
 return {db,first,second};
}
test('report holds are scoped by job and age',async()=>{const f=counts({error:null,count:2});expect(await countReportDeliveryHolds(f.db,'daily-summary','before')).toBe(2);expect(f.first.eq).toHaveBeenCalledWith('job','daily-summary');expect(f.first.lt).toHaveBeenCalledWith('sent_at','before');});
test.each([{error:null,count:null},{error:{message:'x'},count:2}])('report hold failures are unknown %#',async r=>{const f=counts(r);expect(await countReportDeliveryHolds(f.db,'daily-summary','before')).toBeNull();});
test('report hold exception is unknown',async()=>{const f=counts(null);f.first.lt.mockRejectedValue(new Error('synthetic'));expect(await countReportDeliveryHolds(f.db,'daily-summary','before')).toBeNull();});
test('followup holds count both sources',async()=>{const f=counts({error:null,count:2},{error:null,count:3});expect(await countFollowupDeliveryHolds(f.db,'before')).toBe(5);expect(f.first.eq).toHaveBeenCalledWith('onboarding_email_delivery_state','pending');expect(f.second.eq).toHaveBeenCalledWith('registration_followup_delivery_state','pending');});
test.each([
 [{error:{message:'x'},count:1},{error:null,count:2}],
 [{error:null,count:1},{error:{message:'x'},count:2}],
 [{error:null,count:null},{error:null,count:2}],
 [{error:null,count:1},{error:null,count:null}],
])('incomplete followup hold observation is unknown %#',async(a,b)=>{const f=counts(a,b);expect(await countFollowupDeliveryHolds(f.db,'before')).toBeNull();});
test('followup observation exception is unknown',async()=>{const f=counts(null);f.first.lt.mockRejectedValue(new Error('synthetic'));expect(await countFollowupDeliveryHolds(f.db,'before')).toBeNull();});
function mutation(result:unknown) {
 const q={update:jest.fn(),eq:jest.fn(),select:jest.fn()};q.update.mockReturnValue(q);q.eq.mockReturnValue(q);q.select.mockResolvedValue(result);
 const db={from:jest.fn(()=>q)} as unknown as ReturnType<typeof createServiceRoleClient>;return {db,q};
}
test.each([
 [{error:null,data:[{facility_id:id}]},true], [{error:null,data:[]},false], [{error:null,data:null},false], [{error:null,data:[{facility_id:'other'}]},false], [{error:{message:'x'},data:[{facility_id:id}]},false],
])('report acceptance requires the exact durable row %#',async(result,expected)=>{const f=mutation(result);expect(await markReportDeliveryAccepted(f.db,'daily-summary',id,'period','time')).toBe(expected);expect(f.q.eq).toHaveBeenCalledWith('delivery_state','pending');expect(f.q.eq).toHaveBeenCalledWith('sent_at','time');});
test('report acceptance exception is unknown',async()=>{const f=mutation(null);f.q.select.mockRejectedValue(new Error('synthetic'));expect(await markReportDeliveryAccepted(f.db,'daily-summary',id,'p','time')).toBe(false);});
test.each(['facility','registration'] as const)('%s followup acceptance and release are scoped to the claim',async kind=>{
 const f=mutation({error:null,data:[{id}]});expect(await markFollowupDelivery(f.db,kind,id,'time','delivered')).toBe(true);expect(await releaseFollowupDelivery(f.db,kind,id,'time')).toBe(true);
 expect(f.q.eq).toHaveBeenCalledWith(kind==='facility'?'onboarding_email_sent_at':'registration_followup_sent_at','time');
});
test.each([
 [{error:null,data:[]},false], [{error:null,data:null},false], [{error:null,data:[{id:'other'}]},false], [{error:{message:'x'},data:[{id}]},false],
])('followup transitions require exact durable confirmation %#',async(result,expected)=>{const f=mutation(result);expect(await markFollowupDelivery(f.db,'facility',id,'time','skipped')).toBe(expected);expect(await releaseFollowupDelivery(f.db,'facility',id,'time')).toBe(expected);});
test('followup transition exceptions are unknown',async()=>{const f=mutation(null);f.q.select.mockRejectedValue(new Error('synthetic'));expect(await markFollowupDelivery(f.db,'registration',id,'time','delivered')).toBe(false);expect(await releaseFollowupDelivery(f.db,'registration',id,'time')).toBe(false);});
