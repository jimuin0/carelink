/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const mockContext=jest.fn(),mockRpc=jest.fn(),mockDirect=jest.fn();
jest.mock('@/lib/admin-api-context',()=>({getAdminApiContext:()=>mockContext()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:mockDirect})}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:'test'})}));
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
import {POST} from '../../route';
import {PATCH,DELETE} from '../route';
const METHODS=['PATCH','DELETE'];

function req(method:string,body:unknown={name:'Customer'}){return new NextRequest('http://localhost/api/admin/customers?facility_id='+facility,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});}
beforeEach(()=>{jest.clearAllMocks();mockContext.mockResolvedValue({userId:actor,facilityId:facility});mockRpc.mockResolvedValue({data:{id,facility_id:facility,name:'Customer'},error:null});});
for(const method of METHODS){
 const call=(r:NextRequest,record=id)=>method==='POST'?POST(r):method==='PATCH'?PATCH(r,{params:Promise.resolve({id:record})}):DELETE(r,{params:Promise.resolve({id:record})});
 describe(method,()=>{
 test('CSRF denial prevents mutation',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await call(req(method))).status).toBe(403);expect(mockContext).not.toHaveBeenCalled();});
 test('rate denial prevents mutation',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await call(req(method))).status).toBe(429);expect(checkRateLimit).toHaveBeenCalledWith(null,expect.any(String),20,60000,'admin-customers-'+method.toLowerCase());expect(mockRpc).not.toHaveBeenCalled();});
 if(method!=='POST')test('invalid record ID prevents mutation',async()=>{expect((await call(req(method),'bad')).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([401,403,503])('identity/membership denial %s prevents mutation',async status=>{mockContext.mockResolvedValue(NextResponse.json({error:'denied'},{status}));expect((await call(req(method))).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['XX000',500]])('SQL failure %s never audits success',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE'}});expect((await call(req(method))).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(mockDirect).not.toHaveBeenCalled();});
 test('valid result is scoped and audited only after one atomic call',async()=>{const r=await call(req(method));expect(r.status).toBe(method==='POST'?201:200);const result=await r.json();expect(result).toEqual(method==='DELETE'?{ok:true}:{customer:{id,facility_id:facility,name:'Customer'}});expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc.mock.calls[0][1]).toMatchObject({p_actor_id:actor,p_facility_id:facility,p_customer_id:method==='POST'?null:id,p_action:method==='POST'?'create':method==='PATCH'?'update':'delete'});expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:actor,facilityId:facility,recordId:id}));expect(mockDirect).not.toHaveBeenCalled();});
 if(method!=='DELETE'){
 test.each([{name:''},{name:'  '},{name:'x'.repeat(51)},{name:'C',email:'bad'},{name:'C',birthday:'2026-02-30'},{name:'C',birthday:'bad'},{name:'C',gender:'invalid'},{name:'C',notes:'x'.repeat(2001)},null])('invalid body: %p',async value=>{expect((await call(req(method,value))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 test('invalid JSON does not mutate',async()=>{const r=new NextRequest('http://localhost/api/admin/customers',{method,body:'{'});expect((await call(r)).status).toBe(400);});
 test('optional missing and empty fields normalize to null',async()=>{for(const value of [{name:'Customer'},{name:'Customer',email:'',birthday:''}]){await call(req(method,value));expect(mockRpc.mock.calls.at(-1)[1].p_values).toEqual({name:'Customer',name_kana:null,email:null,phone:null,birthday:null,gender:null,notes:null});}});
 test('full fields preserve normalized values',async()=>{const value={name:' Customer ',name_kana:'カスタマー',email:'synthetic@example.invalid',phone:'090-1234-5678',birthday:'2000-02-29',gender:'other',notes:'Note'};await call(req(method,value));expect(mockRpc.mock.calls[0][1].p_values).toEqual({...value,name:'Customer'});});
 }
 });
}
