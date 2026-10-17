/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const mockIdentity=jest.fn(),mockMembers=jest.fn(),mockRpc=jest.fn(),mockLookup=jest.fn(),mockIn=jest.fn();
jest.mock('@/lib/auth-verification',()=>({...jest.requireActual('@/lib/auth-verification'),verifyAuthUser:()=>mockIdentity()}));
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{},from:()=>{const c:any={select:()=>c,eq:()=>c,in:()=>mockMembers()};return c;}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:()=>{const c:any={select:()=>c,eq:()=>c,in:(...args:unknown[])=>{mockIn(...args);return c;},maybeSingle:()=>mockLookup()};return c;}})}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false),mutationRateLimit:{}}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn()}));
import {GET,PATCH,DELETE} from '../route';
import {checkRateLimit} from '@/lib/rate-limit';
import {checkCsrf} from '@/lib/csrf';
import {writeAuditLog} from '@/lib/audit-logger';
const body={title:'Synthetic',job_type:'Stylist',employment_type:'\u6b63\u793e\u54e1'};
function req(method:string,value:unknown=body){return new NextRequest('http://localhost/api/admin/jobs/'+id,{method,...(method==='GET'?{}:{body:JSON.stringify(value)}),headers:{'Content-Type':'application/json','x-forwarded-for':'127.0.0.1'}});}
beforeEach(()=>{jest.clearAllMocks();mockIdentity.mockResolvedValue({state:'verified',user:{id:actor}});mockMembers.mockResolvedValue({data:[{facility_id:facility,role:'owner'}],error:null});mockLookup.mockResolvedValue({data:{id,facility_id:facility},error:null});mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:null});});
for(const method of ['GET','PATCH','DELETE']){
 const call=(r:NextRequest,record=id)=>(method==='GET'?GET:method==='PATCH'?PATCH:DELETE)(r,{params:Promise.resolve({id:record})});
 describe(method,()=>{
 test('rate guard prevents identity and database work',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await call(req(method))).status).toBe(429);expect(mockIdentity).not.toHaveBeenCalled();});
 if(method!=='GET')test('CSRF denial prevents identity',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await call(req(method))).status).toBe(403);expect(mockIdentity).not.toHaveBeenCalled();});
 test('invalid ID prevents identity',async()=>{expect((await call(req(method),'bad')).status).toBe(400);expect(mockIdentity).not.toHaveBeenCalled();});
 test('missing auth precedes input validation',async()=>{mockIdentity.mockResolvedValue({state:'unauthenticated'});expect((await call(req(method,null))).status).toBe(401);expect(mockMembers).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
 test('unavailable identity returns503',async()=>{mockIdentity.mockResolvedValue({state:'unavailable'});expect((await call(req(method))).status).toBe(503);});
 test.each([[],null])('no memberships %p denies',async data=>{mockMembers.mockResolvedValue({data,error:null});expect((await call(req(method))).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
 test('membership DB failure caught',async()=>{mockMembers.mockResolvedValue({data:null,error:{message:'PRIVATE'}});expect((await call(req(method))).status).toBe(500);});
 test('job lookup failure caught',async()=>{mockLookup.mockResolvedValue({data:null,error:{message:'PRIVATE'}});expect((await call(req(method))).status).toBe(500);});
 test('missing or foreign job fails404',async()=>{mockLookup.mockResolvedValue({data:null,error:null});expect((await call(req(method))).status).toBe(404);expect(mockRpc).not.toHaveBeenCalled();});
 test('success keeps envelope and scopes the atomic mutation',async()=>{const r=await call(req(method));expect(r.status).toBe(200);expect(await r.json()).toEqual(method==='DELETE'?{success:true}:{job:{id,facility_id:facility}});expect(mockIn).toHaveBeenCalledWith('facility_id',[facility]);if(method!=='GET'){expect(mockRpc.mock.calls[0][1]).toMatchObject({p_actor_id:actor,p_facility_id:facility,p_record_id:id,p_kind:method==='PATCH'?'job:update':'job:delete'});expect(writeAuditLog).toHaveBeenCalled();}});
 if(method!=='GET')test.each([['42501',403],['P0002',404],['22023',400],['XX000',500]])('final SQL failure %s never audits success',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code}});expect((await call(req(method))).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();});
 });
}
test.each([{...body,title:''},{...body,employment_type:'invalid'},null])('invalid PATCH input causes no mutation %p',async value=>{expect((await PATCH(req('PATCH',value),{params:Promise.resolve({id})})).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('malformed PATCH JSON',async()=>{expect((await PATCH(new Request('http://localhost/api/admin/jobs/'+id,{method:'PATCH',body:'{'}),{params:Promise.resolve({id})})).status).toBe(400);});
test('PATCH full optional fields retain values',async()=>{const value={...body,salary_min:100,salary_max:200,salary_note:'Note',description:'Desc',requirements:'Req',benefits:'Benefits'};await PATCH(req('PATCH',value),{params:Promise.resolve({id})});expect(mockRpc.mock.calls[0][1].p_values).toEqual(value);});

test.each([{salary_min:0.5},{salary_max:2147483648}])('PATCH salary outside database domain is rejected before RPC %p',async salary=>{expect((await PATCH(req('PATCH',{...body,...salary}),{params:Promise.resolve({id})})).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
