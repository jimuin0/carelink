/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({createServiceRoleClient: () => ({rpc:mockRpc})}));
import { NextResponse } from 'next/server';
import { saveAdminStaff } from '../admin-staff-write';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const input={actorId:actor,facilityId:facility,staffId:id,menuIds:null,values:{name:'Staff'}};
beforeEach(()=>{mockRpc.mockReset();mockRpc.mockResolvedValue({data:{id,facility_id:facility,name:'Menu'},error:null});});
test('create accepts only the scoped durable receipt and sends no direct writes',async()=>{
 const data=await saveAdminStaff(input);expect(data).toEqual({id,facility_id:facility,name:'Menu'});
 expect(mockRpc).toHaveBeenCalledWith('save_admin_staff_atomic',{p_actor_id:actor,p_facility_id:facility,p_staff_id:id,p_values:input.values,p_menu_ids:null});
});
test('assignment omission, clear and replacement remain distinct',async()=>{
 for(const menuIds of [null,[],[actor]]) {await saveAdminStaff({...input,menuIds});expect(mockRpc.mock.calls.at(-1)[1].p_menu_ids).toEqual(menuIds);}
});
test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['57014',500]])('SQL failure %s is bounded and cannot be accepted as success',async(code,status)=>{
 mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:{code,message:'private detail'}});
 const res=await saveAdminStaff(input) as NextResponse;expect(res.status).toBe(status);expect(JSON.stringify(await res.json())).not.toContain('private detail');
});
test.each([null,[],{}, {id:'bad',facility_id:facility},{id,facility_id:actor}])('invalid staff receipt fails closed: %p',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await saveAdminStaff(input) as NextResponse).status).toBe(500);
});
test('different staff ID cannot confirm a patch',async()=>{
 mockRpc.mockResolvedValue({data:{id:actor,facility_id:facility},error:null});expect((await saveAdminStaff({...input,staffId:id}) as NextResponse).status).toBe(500);
});
test('SDK rejection does not retry the mutation or expose its body',async()=>{
 mockRpc.mockRejectedValue({code:'57014',message:'private detail'});const res=await saveAdminStaff(input) as NextResponse;expect(res.status).toBe(500);expect(mockRpc).toHaveBeenCalledTimes(1);
});
