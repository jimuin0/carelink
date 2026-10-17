/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',other='44444444-4444-4444-8444-444444444444',id='11111111-1111-4111-8111-111111111111';
const mockIdentity=jest.fn(),mockMembers=jest.fn(),mockRpc=jest.fn(),mockList=jest.fn(),mockIn=jest.fn();
jest.mock('@/lib/auth-verification',()=>({...jest.requireActual('@/lib/auth-verification'),verifyAuthUser:()=>mockIdentity()}));
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{},from:()=>{const c:any={select:()=>c,eq:()=>c,in:()=>mockMembers()};return c;}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:()=>{const c:any={select:()=>c,in:(...args:unknown[])=>{mockIn(...args);return c;},order:()=>mockList()};return c;}})}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false),mutationRateLimit:{}}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn()}));
import {GET,POST} from '../route';
import {checkRateLimit} from '@/lib/rate-limit';
import {checkCsrf} from '@/lib/csrf';
import {writeAuditLog} from '@/lib/audit-logger';
const body={title:'Synthetic',job_type:'Stylist',employment_type:'正社員'};
function req(method:string,value:unknown=body){return new NextRequest('http://localhost/api/admin/jobs',{method,...(method==='GET'?{}:{body:JSON.stringify(value)}),headers:{'Content-Type':'application/json','x-forwarded-for':'127.0.0.1'}});}
beforeEach(()=>{jest.clearAllMocks();mockIdentity.mockResolvedValue({state:'verified',user:{id:actor}});mockMembers.mockResolvedValue({data:[{facility_id:facility,role:'owner'}],error:null});mockList.mockResolvedValue({data:[{id,facility_id:facility}],error:null});mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:null});});
for(const method of ['GET','POST']){
 const call=(r:NextRequest)=>method==='GET'?GET(r):POST(r);
 describe(method,()=>{
 test('rate guard prevents identity and database work',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await call(req(method))).status).toBe(429);expect(mockIdentity).not.toHaveBeenCalled();});
 test('missing auth precedes input validation',async()=>{mockIdentity.mockResolvedValue({state:'unauthenticated'});expect((await call(req(method,null))).status).toBe(401);expect(mockMembers).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
 test('unavailable identity is 503',async()=>{mockIdentity.mockResolvedValue({state:'unavailable'});expect((await call(req(method))).status).toBe(503);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([[],null])('no memberships %p cannot write or leak list',async data=>{mockMembers.mockResolvedValue({data,error:null});const r=await call(req(method));expect(r.status).toBe(method==='GET'?200:403);if(method==='GET')expect(await r.json()).toEqual({jobs:[]});expect(mockRpc).not.toHaveBeenCalled();});
 test('membership DB error is surfaced safely',async()=>{mockMembers.mockResolvedValue({data:[],error:{message:'PRIVATE'}});const r=await call(req(method));expect(r.status).toBe(500);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(mockRpc).not.toHaveBeenCalled();});
 test('identity rejection is caught',async()=>{mockIdentity.mockRejectedValue(new Error('PRIVATE'));expect((await call(req(method))).status).toBe(500);});
 });
}
test('GET scopes all owned facilities and returns list',async()=>{mockMembers.mockResolvedValue({data:[{facility_id:facility},{facility_id:other}],error:null});expect(await (await GET(req('GET'))).json()).toEqual({jobs:[{id,facility_id:facility}]});expect(mockIn).toHaveBeenCalledWith('facility_id',[facility,other]);});
test('GET data null becomes empty list',async()=>{mockList.mockResolvedValue({data:null,error:null});expect(await (await GET(req('GET'))).json()).toEqual({jobs:[]});});
test('GET query error becomes 500',async()=>{mockList.mockResolvedValue({data:null,error:{message:'PRIVATE'}});expect((await GET(req('GET'))).status).toBe(500);});
test('POST CSRF denial prevents identity',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await POST(req('POST'))).status).toBe(403);expect(mockIdentity).not.toHaveBeenCalled();});
test.each([{...body,title:''},{...body,employment_type:'invalid'},null])('POST invalid input %p cannot mutate',async value=>{expect((await POST(req('POST',value))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('POST malformed JSON rejected',async()=>{expect((await POST(new Request('http://localhost/api/admin/jobs',{method:'POST',body:'{'}))).status).toBe(400);});
test('POST one facility keeps implicit target and normalizes optional values',async()=>{const r=await POST(req('POST'));expect(r.status).toBe(201);expect(await r.json()).toEqual({job:{id,facility_id:facility}});expect(mockRpc.mock.calls[0][1]).toEqual({p_actor_id:actor,p_facility_id:facility,p_record_id:null,p_kind:'job:create',p_values:{...body,salary_min:null,salary_max:null,salary_note:null,description:null,requirements:null,benefits:null}});expect(writeAuditLog).toHaveBeenCalled();});
test('POST full optional fields preserve values',async()=>{const value={...body,salary_min:100,salary_max:200,salary_note:'Note',description:'Desc',requirements:'Req',benefits:'Benefits'};expect((await POST(req('POST',value))).status).toBe(201);expect(mockRpc.mock.calls[0][1].p_values).toEqual(value);});
test.each([undefined,''])('POST multiple owners must choose target %p',async facility_id=>{mockMembers.mockResolvedValue({data:[{facility_id:facility},{facility_id:other}],error:null});expect((await POST(req('POST',{...body,facility_id}))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('POST foreign target forbidden',async()=>{expect((await POST(req('POST',{...body,facility_id:other}))).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
test('POST explicit owned target is used and checked in receipt',async()=>{mockMembers.mockResolvedValue({data:[{facility_id:facility},{facility_id:other}],error:null});mockRpc.mockResolvedValue({data:{id,facility_id:other},error:null});expect((await POST(req('POST',{...body,facility_id:other}))).status).toBe(201);expect(mockRpc.mock.calls[0][1].p_facility_id).toBe(other);});
test.each([['42501',403],['P0002',404],['22023',400],['23505',409],['XX000',500]])('POST final authority/DB failure %s is not success',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE'}});expect((await POST(req('POST'))).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();});

test.each([{salary_min:0.5},{salary_max:2147483648}])('POST salary outside database domain is rejected before RPC %p',async salary=>{expect((await POST(req('POST',{...body,...salary}))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
