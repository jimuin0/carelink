/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { countBirthdayDeliveryHolds, markBirthdayDeliveryAccepted } from '../birthday-delivery-state';
import type { createServiceRoleClient } from '../supabase-server';
const userId='68000000-0000-4000-8000-000000000001';
function fixture() {
 const q={ select:jest.fn(), update:jest.fn(), eq:jest.fn(), lt:jest.fn() };
 q.select.mockReturnValue(q);q.update.mockReturnValue(q);q.eq.mockReturnValue(q);
 const db={from:jest.fn(()=>q)} as unknown as ReturnType<typeof createServiceRoleClient>;
 return {db,q};
}
test('counts only stale pending claims',async()=>{
 const f=fixture();f.q.lt.mockResolvedValue({count:3,error:null});expect(await countBirthdayDeliveryHolds(f.db,'2026-10-29T00:00:00Z')).toBe(3);
 expect(f.q.eq).toHaveBeenCalledWith('delivery_state','pending');expect(f.q.lt).toHaveBeenCalledWith('notified_at','2026-10-29T00:00:00Z');
});
test.each([{count:null,error:null},{count:1,error:{message:'error'}}])('hold observation errors are unknown %#',async result=>{
 const f=fixture();f.q.lt.mockResolvedValue(result);expect(await countBirthdayDeliveryHolds(f.db,'x')).toBeNull();
});
test('hold observation exception is unknown',async()=>{const f=fixture();f.q.lt.mockRejectedValue(new Error('synthetic'));expect(await countBirthdayDeliveryHolds(f.db,'x')).toBeNull();});
test.each([
 [{data:[{user_id:userId}],error:null},true],
 [{data:[{user_id:'different'}],error:null},false],
 [{data:[],error:null},false],
 [{data:null,error:null},false],
 [{data:[{user_id:userId}],error:{message:'error'}},false],
])('acceptance needs exact durable confirmation %#',async(result,expected)=>{
 const f=fixture();f.q.select.mockResolvedValue(result);expect(await markBirthdayDeliveryAccepted(f.db,userId,2026,'time')).toBe(expected);
 expect(f.q.eq).toHaveBeenCalledWith('delivery_state','pending');expect(f.q.eq).toHaveBeenCalledWith('notified_at','time');expect(f.q.update).toHaveBeenCalledWith({delivery_state:'delivered'});
});
test('lost acceptance update response stays unknown',async()=>{const f=fixture();f.q.select.mockRejectedValue(new Error('synthetic'));expect(await markBirthdayDeliveryAccepted(f.db,userId,2026,'time')).toBe(false);});
