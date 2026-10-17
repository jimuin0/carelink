/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest} from 'next/server';
const actor='33333333-3333-4333-8333-333333333333',facility='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
const mockRpc=jest.fn(),mockWrite=jest.fn();
jest.mock('@/lib/admin-api-context',()=>({getAdminApiContext:async()=>({userId:actor,facilityId:facility})}));
jest.mock('@/lib/auth-verification',()=>({...jest.requireActual('@/lib/auth-verification'),verifyAuthUser:async()=>({state:'verified',user:{id:actor}})}));
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{},from:()=>{const c:any={select:()=>c,eq:()=>c,in:()=>c,maybeSingle:async()=>({data:{facility_id:facility},error:null}),then:(resolve:(x:unknown)=>void)=>resolve({data:[{facility_id:facility,role:'owner'}],error:null})};return c;}})}));
jest.mock('@/lib/csrf',()=>({checkCsrf:()=>null}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:async()=>false,mutationRateLimit:null}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({ua:null,ip:'127.0.0.1'})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({rpc:mockRpc,from:()=>{const result=()=>({data:{id,facility_id:facility},error:null});const c:any={insert:()=>{mockWrite();return c;},update:()=>{mockWrite();return c;},delete:()=>{mockWrite();return c;},eq:()=>c,in:()=>c,select:()=>c,maybeSingle:async()=>result(),single:async()=>result(),then:(resolve:(x:unknown)=>void)=>resolve(result())};return c;}})}));
import {POST as catalog} from '../catalog/route';
import {POST as blog} from '../blog/route';
import {PATCH as blogUpdate,DELETE as blogDelete} from '../blog/[id]/route';
import {POST as qa} from '../qa/route';
import {POST as job} from '../jobs/route';
import {PATCH as catalogUpdate,DELETE as catalogDelete} from '../catalog/[id]/route';
import {PATCH as jobUpdate,DELETE as jobDelete} from '../jobs/[id]/route';
import {writeAuditLog} from '@/lib/audit-logger';
beforeEach(()=>{jest.clearAllMocks();mockRpc.mockResolvedValue({data:null,error:{code:'42501'}});});
const cases=[
 ['catalog','POST',{name:'Synthetic'},catalog,''],['blog-create','POST',{title:'Synthetic',content:'Content'},blog,''],
 ['blog-update','PATCH',{title:'Synthetic'},blogUpdate,''],['blog-delete','DELETE',{},blogDelete,''],
 ['qa-answer','POST',{qa_id:id,answer:'Synthetic'},qa,''],['qa-toggle','POST',{qa_id:id,is_public:true},qa,'&action=toggle-public'],['qa-delete','POST',{qa_id:id},qa,'&action=delete'],
 ['catalog-update','PATCH',{name:'Synthetic'},catalogUpdate,''],['catalog-delete','DELETE',{},catalogDelete,''],
 ['job-update','PATCH',{title:'Synthetic',job_type:'Stylist',employment_type:'\u6b63\u793e\u54e1'},jobUpdate,''],['job-delete','DELETE',{},jobDelete,''],
 ['job-create','POST',{title:'Synthetic',job_type:'美容師',employment_type:'正社員'},job,''],
] as const;
test.each(cases)('%s denies authority revoked after the HTTP gate',async(_label,method,body,handler,suffix)=>{
 const r=new NextRequest('http://localhost/api/admin/example?facility_id='+facility+suffix,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
 const response=await handler(r,{params:Promise.resolve({id})});expect(response.status).toBe(403);expect(mockWrite).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();
});
