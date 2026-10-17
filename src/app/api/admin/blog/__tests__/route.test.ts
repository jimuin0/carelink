/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest,NextResponse} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const mockContext=jest.fn(),mockRpc=jest.fn(),mockDirect=jest.fn();
jest.mock('@/lib/admin-api-context',()=>({getAdminApiContext:()=>mockContext()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:mockDirect})}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(()=>false)}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:'test',ip:'127.0.0.1'})}));
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
import {POST} from '../route';
const cases=[['blog:create','POST',{title:'Synthetic',content:'Content'},POST,'','post']] as const;
function invalidBodies(_kind:string):unknown[]{return [null,{title:'',content:'C'},{title:'x'.repeat(201),content:'C'},{title:'T',content:''},{title:'T',content:'x'.repeat(50001)}];}

beforeEach(()=>{jest.clearAllMocks();mockContext.mockResolvedValue({userId:actor,facilityId:facility});mockRpc.mockResolvedValue({data:{id,facility_id:facility},error:null});});
function req(method:string,body:unknown,suffix=''){return new NextRequest('http://localhost/api/admin/example?facility_id='+facility+suffix,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});}
for(const [kind,method,body,handler,suffix,wrapper] of cases){
 const invoke=(r:NextRequest,record=id)=>handler(r,{params:Promise.resolve({id:record})});
 describe(kind,()=>{
 test('CSRF rejection prevents auth and mutation',async()=>{jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({error:'csrf'},{status:403}));expect((await invoke(req(method,body,suffix))).status).toBe(403);expect(mockContext).not.toHaveBeenCalled();});
 test('rate guard prevents mutation',async()=>{jest.mocked(checkRateLimit).mockResolvedValueOnce(true);expect((await invoke(req(method,body,suffix))).status).toBe(429);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([401,403,503])('auth denial %s prevents mutation',async status=>{mockContext.mockResolvedValue(NextResponse.json({error:'denied'},{status}));expect((await invoke(req(method,body,suffix))).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();});
 if(kind.startsWith('blog:') && method!=='POST')test('invalid record ID prevents mutation',async()=>{expect((await invoke(req(method,body,suffix),'bad')).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['XX000',500]])('SQL failure %s never audits success',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE'}});expect((await invoke(req(method,body,suffix))).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(mockDirect).not.toHaveBeenCalled();});
 test('successful result verifies scope and retains response envelope',async()=>{const r=await invoke(req(method,body,suffix));expect(r.status).toBe(kind.endsWith(':create')?201:200);expect(await r.json()).toEqual(wrapper==='ok'?{ok:true}:{[wrapper]:{id,facility_id:facility}});expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc.mock.calls[0][1]).toMatchObject({p_actor_id:actor,p_facility_id:facility,p_record_id:kind.endsWith(':create')?null:id,p_kind:kind});expect(mockDirect).not.toHaveBeenCalled();expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:actor,facilityId:facility,recordId:id}));});
 if(method!=='DELETE'){
 test('invalid JSON prevents mutation',async()=>{const r=new NextRequest('http://localhost/api/admin/example?facility_id='+facility+suffix,{method,body:'{'});expect((await invoke(r)).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 for(const invalid of invalidBodies(kind))test('invalid input '+JSON.stringify(invalid).slice(0,70),async()=>{expect((await invoke(req(method,invalid,suffix))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 }
 });
}
test.each(['Hello world','\u65e5\u672c\u8a9e'])('slug and publication values for %s',async title=>{expect((await POST(req('POST',{title,content:'Content',is_published:true}))).status).toBe(201);expect(mockRpc.mock.calls[0][1].p_values).toMatchObject({title,content:'Content',is_published:true,slug:expect.stringMatching(/^(hello-world|post)-[a-f0-9]{10}$/)});expect(mockRpc.mock.calls[0][1].p_values).not.toHaveProperty('published_at');});
