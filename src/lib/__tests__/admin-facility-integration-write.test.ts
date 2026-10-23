/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const rpc=jest.fn();jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc})}));
import {NextResponse} from 'next/server';import {saveAdminFacilityIntegration} from '../admin-facility-integration-write';
const id='22222222-2222-4222-8222-222222222222',other='44444444-4444-4444-8444-444444444444';const input={actorId:id,facilityId:id,kind:'gbp:connect' as const,expected:{},values:{place_id:'NewPlace',cid:null}};
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:{id,facility_id:id},error:null});});
test('scoped write receipt',async()=>{expect(await saveAdminFacilityIntegration(input)).toEqual({id,facility_id:id});expect(rpc).toHaveBeenCalledWith('save_admin_facility_integration_atomic',{p_actor_id:id,p_facility_id:id,p_kind:'gbp:connect',p_expected:{},p_values:input.values});});
test.each([['42501',403],['P0002',404],['40001',409],['23505',409],['22023',400],['08006',500]])('SQL %s cannot certify success',async(code,status)=>{rpc.mockResolvedValue({data:{id,facility_id:id},error:{code,message:'private'}});const r=await saveAdminFacilityIntegration(input) as NextResponse;expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain('private');});
test.each([null,{},[],{id,facility_id:other},{id:other,facility_id:id}])('wrong receipt %p',async data=>{rpc.mockResolvedValue({data,error:null});expect((await saveAdminFacilityIntegration(input) as NextResponse).status).toBe(500);});
test('domain row has its own ID',async()=>{rpc.mockResolvedValue({data:{id:other,facility_id:id,domain:'new.example.invalid',is_verified:false},error:null});expect(await saveAdminFacilityIntegration({...input,kind:'domain:configure',values:{domain:'new.example.invalid'}})).toEqual({id:other,facility_id:id,domain:'new.example.invalid',is_verified:false});});
test('SDK throw bounded without retries',async()=>{rpc.mockRejectedValue({code:'08006',message:'private'});expect((await saveAdminFacilityIntegration(input) as NextResponse).status).toBe(500);expect(rpc).toHaveBeenCalledTimes(1);});

test.each([{}, {domain:'wrong.example.invalid'}, {domain:'new.example.invalid'}])('domain receipt cannot certify an unexpected configuration: %p',async values=>{rpc.mockResolvedValue({data:{id:other,facility_id:id,domain:'new.example.invalid',is_verified:true},error:null});expect((await saveAdminFacilityIntegration({...input,kind:'domain:configure',values}) as NextResponse).status).toBe(500);});
test('verified receipt must match the actual DNS-bound domain',async()=>{rpc.mockResolvedValue({data:{id:other,facility_id:id,domain:'new.example.invalid',is_verified:true},error:null});expect(await saveAdminFacilityIntegration({...input,kind:'domain:verify',expected:{domain:'new.example.invalid'}})).toEqual(expect.objectContaining({is_verified:true}));});

// 回帰（2026年10月23日）: 同じ Place ID を 2 つの施設に付けられた（他店の Google 評価の流用）。
// 索引違反は「設定が変更されました」ではなく、別の店舗に登録済みであることを伝える。
test('a Place ID already attached to another facility is refused with its own message',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "uq_facility_profiles_gbp_place_id"'}});
 const r=await saveAdminFacilityIntegration(input) as NextResponse;expect(r.status).toBe(409);
 const body=await r.json();expect(body.code).toBe('GBP_PLACE_TAKEN');expect(body.error).toContain('別の店舗に登録されています');expect(JSON.stringify(body)).not.toContain('uq_facility');
});
test('a unique violation on a domain keeps the generic conflict message',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'23505'}});
 const r=await saveAdminFacilityIntegration({...input,kind:'domain:configure',values:{domain:'new.example.invalid'}}) as NextResponse;
 expect(r.status).toBe(409);expect((await r.json()).error).toBe('設定が変更されました。再読み込みしてください');
});
