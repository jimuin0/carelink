/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const mockIdentity=jest.fn(),mockCatalog=jest.fn(),mockMember=jest.fn(),mockRpc=jest.fn(),mockWrite=jest.fn();
jest.mock('@/lib/auth-verification',()=>({...jest.requireActual('@/lib/auth-verification'),verifyAuthUser:()=>mockIdentity()}));
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{},from:()=>{const c:any={select:()=>c,eq:()=>c,in:()=>c,maybeSingle:()=>mockMember()};return c;}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:()=>{const c:any={select:()=>c,eq:()=>c,maybeSingle:()=>mockCatalog(),update:mockWrite,delete:mockWrite};return c;}})}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:'test',ip:'127.0.0.1'})}));
import {PATCH,DELETE} from '../route';
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
function req(method:string,body:unknown={name:'Catalog'}){return new NextRequest('http://localhost/api/admin/catalog/'+id,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});}
beforeEach(()=>{jest.clearAllMocks();mockIdentity.mockResolvedValue({state:'verified',user:{id:actor}});mockCatalog.mockResolvedValue({data:{facility_id:facility},error:null});mockMember.mockResolvedValue({data:{facility_id:facility},error:null});mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:null});});
for(const method of ['PATCH','DELETE']){
 const call=(r:NextRequest,record=id)=>(method==='PATCH'?PATCH:DELETE)(r,{params:Promise.resolve({id:record})});
 describe(method,()=>{
 test('CSRF denial prevents all auth',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await call(req(method))).status).toBe(403);expect(mockIdentity).not.toHaveBeenCalled();});
 test('rate denial prevents mutation',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await call(req(method))).status).toBe(429);expect(mockRpc).not.toHaveBeenCalled();});
 test('invalid ID prevents auth',async()=>{expect((await call(req(method),'bad')).status).toBe(400);expect(mockIdentity).not.toHaveBeenCalled();});
 test.each([['unauthenticated',401],['unavailable',503]])('identity %s fails closed',async(state,status)=>{mockIdentity.mockResolvedValue({state});expect((await call(req(method))).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();});
 test('catalog read failure returns503',async()=>{mockCatalog.mockResolvedValue({data:null,error:{message:'PRIVATE'}});expect((await call(req(method))).status).toBe(503);expect(mockRpc).not.toHaveBeenCalled();});
 test('catalog missing returns401',async()=>{mockCatalog.mockResolvedValue({data:null,error:null});expect((await call(req(method))).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
 test('membership error returns503',async()=>{mockMember.mockResolvedValue({data:null,error:{message:'PRIVATE'}});expect((await call(req(method))).status).toBe(503);expect(mockRpc).not.toHaveBeenCalled();});
 test('membership missing returns401',async()=>{mockMember.mockResolvedValue({data:null,error:null});expect((await call(req(method))).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
 test('catalog read rejection is caught',async()=>{mockCatalog.mockRejectedValue(new Error('PRIVATE'));expect((await call(req(method))).status).toBe(503);});
 test.each([['42501',403],['P0002',404],['22023',400],['XX000',500]])('final DB failure %s cannot audit success',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code}});expect((await call(req(method))).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(mockWrite).not.toHaveBeenCalled();});
 test('success uses verified scope and preserves response',async()=>{const r=await call(req(method));expect(r.status).toBe(200);expect(await r.json()).toEqual(method==='PATCH'?{item:{id,facility_id:facility}}:{message:'deleted'});expect(mockRpc.mock.calls[0][1]).toMatchObject({p_actor_id:actor,p_facility_id:facility,p_record_id:id,p_kind:method==='PATCH'?'catalog:update':'catalog:delete'});expect(mockWrite).not.toHaveBeenCalled();expect(writeAuditLog).toHaveBeenCalled();});
 });
}
test.each([{name:''},{name:'x'.repeat(201)},{tags:Array(21).fill('x')},null])('invalid PATCH body causes no mutation %p',async body=>{expect((await PATCH(req('PATCH',body),{params:Promise.resolve({id})})).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('malformed PATCH JSON',async()=>{expect((await PATCH(new NextRequest('http://localhost/api/admin/catalog/'+id,{method:'PATCH',body:'{'}),{params:Promise.resolve({id})})).status).toBe(400);});
test.each([{description:null,tags:null},{name:'Title',description:'Desc',tags:['Tag']}])('optional PATCH columns preserved %p',async body=>{await PATCH(req('PATCH',body),{params:Promise.resolve({id})});const {name,...rest}=body as {name?:string;description:string|null;tags:string[]|null};expect(mockRpc.mock.calls[0][1].p_values).toEqual({...rest,...(name===undefined?{}:{title:name})});});
