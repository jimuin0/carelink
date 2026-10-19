/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc})}));
jest.mock('@/lib/with-route',()=>({serverError:()=>NextResponse.json({error:'Unavailable'},{status:500})}));
const mockRpc=jest.fn();
import { NextResponse } from 'next/server';
import { writePlatformControl,platformControlResponse } from '../platform-control-write';
const id='11111111-1111-4111-8111-111111111111';
const actor='22222222-2222-4222-8222-222222222222';
const flag={id,key:'synthetic',enabled:false,rollout_pct:0};
const ticket={id,ticket_status:'resolved',priority:'high',ticket_notes:null,resolved_at:'2026-01-01T00:00:00Z'};
const facility={id,is_verified:false,verified_type:null};
beforeEach(()=>mockRpc.mockReset());
test.each([
 ['flag:create',null,{key:'synthetic',enabled:false,rollout_pct:0},flag],
 ['flag:update',id,{enabled:false,rollout_pct:0},flag],
 ['ticket:update',id,{ticket_status:'resolved',priority:'high',ticket_notes:null},ticket],
 ['facility:verify',id,{is_verified:false},facility],
] as const)('%s confirms exact actor, operation and receipt',async(kind,record,values,data)=>{
 mockRpc.mockResolvedValue({data,error:null});const result=await writePlatformControl(actor,record,kind,values,'/test');expect(result).toEqual(data);
 expect(mockRpc).toHaveBeenCalledWith('manage_platform_control_atomic',{p_actor_id:actor,p_record_id:record,p_kind:kind,p_values:values});
});
test('omitted undefined fields do not fabricate mismatches',async()=>{
 mockRpc.mockResolvedValue({data:flag,error:null});expect(await writePlatformControl(actor,id,'flag:update',{enabled:false,rollout_pct:undefined},'/test')).toEqual(flag);
});
test('record comparison accepts canonical UUID casing',async()=>{
 const upper='AAAA1111-1111-4111-8111-111111111111';mockRpc.mockResolvedValue({data:{...flag,id:upper.toLowerCase()},error:null});
 expect(await writePlatformControl(actor,upper,'flag:update',{enabled:false},'/test')).not.toBeInstanceOf(NextResponse);
});
test.each([['42501',403],['P0002',404],['22023',400],['23505',409],['08006',500],['',500]])('error %s refuses data with status %s',async(code,status)=>{
 mockRpc.mockResolvedValue({data:flag,error:{code,message:'private diagnostic'}});const response=await writePlatformControl(actor,id,'flag:update',{enabled:false},'/test') as NextResponse;expect(response.status).toBe(status);expect(JSON.stringify(await response.json())).not.toContain('private diagnostic');
});
test.each([null,[],{},false,{...flag,id:'bad'},{...flag,id:actor},{...flag,enabled:'false'},{...flag,rollout_pct:101}])('invalid or wrong record receipt %p is never success',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await writePlatformControl(actor,id,'flag:update',{enabled:false},'/test') as NextResponse).status).toBe(500);
});
test.each([
 ['flag:update',{enabled:true},flag],['flag:create',{key:'different'},flag],
 ['ticket:update',{ticket_status:'open'},ticket],['facility:verify',{is_verified:true},facility],
] as const)('%s rejects a valid-shaped contradictory receipt',async(kind,values,data)=>{
 mockRpc.mockResolvedValue({data,error:null});expect((await writePlatformControl(actor,kind==='flag:create'?null:id,kind,values,'/test') as NextResponse).status).toBe(500);
});
test('private response wrapper catches rejection without leaking it',async()=>{
 const response=await platformControlResponse(async()=>{throw new Error('private diagnostic')},'/test');expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('private diagnostic');
});
test.each([200,400,403,404,409,500])('private response wrapper keeps status %s and forbids caching',async status=>{
 const response=await platformControlResponse(async()=>NextResponse.json({ok:false},{status}),'/test');expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('no-store');
});
