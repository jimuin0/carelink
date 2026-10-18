/** @jest-environment node */
import { PATCH } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
const APP_UUID='11111111-1111-4111-8111-111111111111';
const FACILITY_UUID='22222222-2222-4222-8222-222222222222';
const USER_ID='33333333-3333-4333-8333-333333333333';
const mockGetUser=jest.fn();const mockApplication=jest.fn();const mockMember=jest.fn();const mockAdminFrom=jest.fn();const mockRpc=jest.fn();
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn()}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn()}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:'synthetic'})}));
jest.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[],set:jest.fn()})}));
jest.mock('@supabase/ssr',()=>({createServerClient:()=>({auth:{getUser:mockGetUser}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockAdminFrom,rpc:mockRpc})}));
function chain(terminal:jest.Mock){const c:Record<string,unknown>={};for(const key of ['select','eq','in'])c[key]=jest.fn(()=>c);c.maybeSingle=terminal;return c;}
function makeRequest(body:unknown={status:'reviewing'},ip='1.2.3.4'){return new Request('https://carelink.invalid/api/admin/job-applications/'+APP_UUID,{method:'PATCH',headers:{'Content-Type':'application/json','x-forwarded-for':ip},body:JSON.stringify(body)});}
function props(id=APP_UUID){return {params:Promise.resolve({id})};}
function receipt(status='reviewing',application:object={}){return {application:{id:APP_UUID,facility_id:FACILITY_UUID,status,...application},previous_status:'pending'};}
beforeEach(()=>{
 jest.resetAllMocks();(checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockResolvedValue(false);
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic';
 mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}},error:null});
 mockApplication.mockResolvedValue({data:{facility_id:FACILITY_UUID,status:'pending'},error:null});mockMember.mockResolvedValue({data:{role:'owner'},error:null});
 mockAdminFrom.mockImplementation(table=>chain(table==='job_applications'?mockApplication:mockMember));
 mockRpc.mockImplementation(async(_name,args)=>({data:receipt(args.p_patch.status??'pending'),error:null}));
});
afterEach(()=>jest.useRealTimers());
test('CSRF denial precedes all authority reads',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response(null,{status:403}));expect((await PATCH(makeRequest(),props())).status).toBe(403);expect(mockGetUser).not.toHaveBeenCalled();});
test('rate limit denial is429 before auth',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await PATCH(makeRequest(),props())).status).toBe(429);expect(mockGetUser).not.toHaveBeenCalled();});
test('rate limit uses20/min and the last trusted forwarded address',async()=>{expect((await PATCH(makeRequest({},'1.2.3.4, 5.6.7.8'),props())).status).toBe(400);expect(checkRateLimit).toHaveBeenCalledWith(null,'5.6.7.8',20,60000,'job-applications-patch');});
test('invalid ID is400 before auth',async()=>{expect((await PATCH(makeRequest(),props('malformed'))).status).toBe(400);expect(mockGetUser).not.toHaveBeenCalled();});
test('authoritatively absent identity is401 without reading applications',async()=>{mockGetUser.mockResolvedValue({data:{user:null},error:null});expect((await PATCH(makeRequest(),props())).status).toBe(401);expect(mockAdminFrom).not.toHaveBeenCalled();});
test.each(['data-error','null-error','throw','timeout'])('uncertain auth %s is503/no-store and cannot read private rows',async fault=>{
 if(fault==='data-error')mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}},error:{code:'unknown'}});
 if(fault==='null-error')mockGetUser.mockResolvedValue({data:{user:null},error:{code:'unknown'}});
 if(fault==='throw')mockGetUser.mockRejectedValue(new Error('synthetic-private'));
 if(fault==='timeout'){jest.useFakeTimers();mockGetUser.mockReturnValue(new Promise(()=>{}));}
 const result=PATCH(makeRequest(),props());if(fault==='timeout')await jest.advanceTimersByTimeAsync(5000);
 const response=await result;expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(mockAdminFrom).not.toHaveBeenCalled();
});
test.each(['application','membership'])('an authoritative missing %s is404',async stage=>{(stage==='application'?mockApplication:mockMember).mockResolvedValue({data:null,error:null});expect((await PATCH(makeRequest(),props())).status).toBe(404);expect(mockRpc).not.toHaveBeenCalled();});
test.each(['application','membership'])('errored %s with or without data never grants authority',async stage=>{
 for(const data of [null,{facility_id:FACILITY_UUID,role:'owner'}]){
  (stage==='application'?mockApplication:mockMember).mockResolvedValue({data,error:{code:'08006',message:'synthetic-private'}});
  const response=await PATCH(makeRequest(),props());expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('synthetic-private');
 }
 expect(mockRpc).not.toHaveBeenCalled();
});
test.each(['application','membership'])('a rejected %s query is unavailable, not a missing row',async stage=>{(stage==='application'?mockApplication:mockMember).mockRejectedValue(new Error('synthetic-private'));expect((await PATCH(makeRequest(),props())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});
test.each(['application','membership'])('a pending %s query expires before business writes',async stage=>{
 jest.useFakeTimers();(stage==='application'?mockApplication:mockMember).mockReturnValue(new Promise(()=>{}));
 const result=PATCH(makeRequest(),props());await jest.advanceTimersByTimeAsync(5000);expect((await result).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null,[],1,{}, {status:'invalid'}, {status:null},{status:0},{notes:1},{notes:{}},{referral_fee_yen:-1},{referral_fee_yen:'100'},{referral_fee_yen:10000000},{referral_fee_yen:1.2}])('invalid application patch %p is400 without a write',async body=>{expect((await PATCH(makeRequest(body),props())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('broken JSON is400 without mutation',async()=>{const request=new Request('https://carelink.invalid/api/admin/job-applications/'+APP_UUID,{method:'PATCH',body:'not-json'});expect((await PATCH(request,props())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test.each(['pending','reviewing','interview_scheduled','interview_done','offer_made','hired','rejected','withdrawn'])('valid status %s uses the atomic actor/facility scope',async status=>{
 const response=await PATCH(makeRequest({status}),props());expect(response.status).toBe(200);expect((await response.json()).application.id).toBe(APP_UUID);
 expect(mockRpc).toHaveBeenCalledWith('update_job_application_atomic',{p_actor_id:USER_ID,p_facility_id:FACILITY_UUID,p_application_id:APP_UUID,p_patch:{status}});
 expect(mockAdminFrom.mock.calls.map(([table])=>table)).toEqual(['job_applications','facility_members']);
});
test.each([0,300000,9999999,null])('valid/null fee %p keeps existing semantics in the gateway',async value=>{expect((await PATCH(makeRequest({referral_fee_yen:value}),props())).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_patch).toEqual({referral_fee_yen:value});});
test.each(['',null,'Synthetic note'])('valid notes %p are retained exactly',async notes=>{expect((await PATCH(makeRequest({notes}),props())).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_patch).toEqual({notes});});
test('note truncation cannot split a Unicode surrogate pair',async()=>{expect((await PATCH(makeRequest({notes:'😀'.repeat(2001)}),props())).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_patch.notes).toBe('😀'.repeat(2000));});
test('client timestamps, billing flags and actor IDs cannot enter a valid patch',async()=>{expect((await PATCH(makeRequest({status:'hired',hired_at:'2000-01-01',fee_paid_at:'2000-01-01',user_id:FACILITY_UUID}),props())).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_patch).toEqual({status:'hired'});});
test('a current already-hired receipt uses the DB timestamp decision, not the stale preflight state',async()=>{mockRpc.mockResolvedValue({data:{...receipt('hired',{hired_at:'2000-01-01T00:00:00Z'}),previous_status:'hired'},error:null});const response=await PATCH(makeRequest({status:'hired'}),props());expect(response.status).toBe(200);expect(mockRpc.mock.calls[0][1].p_patch).not.toHaveProperty('hired_at');expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({oldValues:{status:'hired'}}));});
test.each([['42501',404],['P0002',404],['22023',400],['08006',500]])('gateway rejection %s maps to%s and never becomes success alongside data',async(code,status)=>{mockRpc.mockResolvedValue({data:receipt(),error:{code,message:'synthetic-private'}});const response=await PATCH(makeRequest(),props());expect(response.status).toBe(status);expect(await response.text()).not.toContain('synthetic-private');expect(writeAuditLog).not.toHaveBeenCalled();});
test.each([null,{},[],receipt('reviewing',{id:FACILITY_UUID}),receipt('reviewing',{facility_id:USER_ID}),receipt('hired')])('unconfirmed gateway receipt %p is500 without a success audit',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await PATCH(makeRequest(),props())).status).toBe(500);expect(writeAuditLog).not.toHaveBeenCalled();});
test('uppercase UUIDs retain the same application identity',async()=>{const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';mockRpc.mockResolvedValue({data:receipt('reviewing',{id}),error:null});expect((await PATCH(makeRequest(),props(id.toUpperCase()))).status).toBe(200);expect(mockRpc.mock.calls[0][1].p_application_id).toBe(id);});

test('an unexpected rejected gateway cannot escape as HTML or reveal its details',async()=>{
 mockRpc.mockRejectedValue(new Error('synthetic-private'));const response=await PATCH(makeRequest(),props());expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(await response.json())).not.toContain('synthetic-private');expect(writeAuditLog).not.toHaveBeenCalled();
});
