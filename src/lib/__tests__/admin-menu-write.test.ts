/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({createServiceRoleClient: () => ({rpc:mockRpc})}));
import { NextResponse } from 'next/server';
import { saveAdminMenu } from '../admin-menu-write';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const input={actorId:actor,facilityId:facility,menuId:null,values:{name:'Menu',category:'Cut'}};
beforeEach(()=>{mockRpc.mockReset();mockRpc.mockResolvedValue({data:{id,facility_id:facility,name:'Menu'},error:null});});
test('create accepts only the scoped durable receipt and sends no direct writes',async()=>{
 const data=await saveAdminMenu(input);expect(data).toEqual({id,facility_id:facility,name:'Menu'});
 expect(mockRpc).toHaveBeenCalledWith('save_admin_menu_atomic',{p_actor_id:actor,p_facility_id:facility,p_menu_id:null,p_values:input.values,p_check_photo:false,p_expected_photo:null});
});
test('patch binds expected ID and legacy-photo observation',async()=>{
 expect(await saveAdminMenu({...input,menuId:id,checkPhoto:true,expectedPhoto:'https://images.unsplash.com/existing'})).not.toBeInstanceOf(NextResponse);
 expect(mockRpc.mock.calls[0][1]).toMatchObject({p_menu_id:id,p_check_photo:true,p_expected_photo:'https://images.unsplash.com/existing'});
});
test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['57014',500]])('SQL failure %s is bounded and cannot be accepted as success',async(code,status)=>{
 mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:{code,message:'private detail'}});
 const res=await saveAdminMenu(input) as NextResponse;expect(res.status).toBe(status);expect(JSON.stringify(await res.json())).not.toContain('private detail');
});
test.each([null,[],{}, {id:'bad',facility_id:facility},{id,facility_id:actor}])('invalid create receipt fails closed: %p',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await saveAdminMenu(input) as NextResponse).status).toBe(500);
});
test('different menu ID cannot confirm a patch',async()=>{
 mockRpc.mockResolvedValue({data:{id:actor,facility_id:facility},error:null});expect((await saveAdminMenu({...input,menuId:id}) as NextResponse).status).toBe(500);
});
test('SDK rejection does not retry the mutation or expose its body',async()=>{
 mockRpc.mockRejectedValue({code:'57014',message:'private detail'});const res=await saveAdminMenu(input) as NextResponse;expect(res.status).toBe(500);expect(mockRpc).toHaveBeenCalledTimes(1);
});
