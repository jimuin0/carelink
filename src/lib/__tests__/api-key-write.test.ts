/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockRpc=jest.fn();
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc})}));
import { NextResponse } from 'next/server';
import { manageFacilityApiKey } from '../api-key-write';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const key={id,facility_id:facility,name:'Synthetic',key_prefix:'ck_live_12345678',scopes:['bookings:read'],is_active:true,last_used_at:null,expires_at:null,created_at:'2026-10-17T00:00:00Z'};
const input={actorId:actor,facilityId:facility,keyId:null,action:'create' as const,values:{}};
beforeEach(()=>{mockRpc.mockReset();mockRpc.mockResolvedValue({data:key,error:null});});
test('scoped receipt strips unexpected secrets before response',async()=>{mockRpc.mockResolvedValue({data:{...key,key_hash:'private',raw_key:'private'},error:null});const {facility_id,...rest}=key;expect(await manageFacilityApiKey(input)).toEqual(rest);});
test('RPC actor is verified server identity',async()=>{await manageFacilityApiKey(input);expect(mockRpc).toHaveBeenCalledWith('manage_facility_api_key_atomic',{p_actor_id:actor,p_facility_id:facility,p_key_id:null,p_action:'create',p_values:{}});});
test.each([['42501',403],['P0002',404],['22023',400],['23505',409],['40001',409],['57014',500]])('error %s fails closed %s',async(code,status)=>{mockRpc.mockResolvedValue({data:key,error:{code,message:'private'}});const r=await manageFacilityApiKey(input) as NextResponse;expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain('private');});
test('revoked permission remains indistinguishable from missing key',async()=>{mockRpc.mockResolvedValue({data:null,error:{code:'42501'}});expect((await manageFacilityApiKey({...input,action:'revoke',keyId:id}) as NextResponse).status).toBe(404);});
test.each([null,{},[],{...key,facility_id:actor},{...key,id:'bad'},{...key,is_active:false}])('bad create receipt %p fails closed',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await manageFacilityApiKey(input) as NextResponse).status).toBe(500);});
test('revoke cannot accept wrong key',async()=>{expect((await manageFacilityApiKey({...input,action:'revoke',keyId:actor}) as NextResponse).status).toBe(500);});
test('revoke must certify inactive',async()=>{expect((await manageFacilityApiKey({...input,action:'revoke',keyId:id}) as NextResponse).status).toBe(500);mockRpc.mockResolvedValue({data:{...key,is_active:false},error:null});expect(await manageFacilityApiKey({...input,action:'revoke',keyId:id})).toEqual(expect.objectContaining({id,is_active:false}));});
test('SDK rejection is sanitized with no retry',async()=>{mockRpc.mockRejectedValue({code:'08006',message:'private'});expect((await manageFacilityApiKey(input) as NextResponse).status).toBe(500);expect(mockRpc).toHaveBeenCalledTimes(1);});
