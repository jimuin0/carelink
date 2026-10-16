/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {NextRequest} from 'next/server';
import {PATCH as verify} from '@/app/api/admin/facility-verify/route';
import {GET as list,POST as create} from '@/app/api/admin/jobs/route';
import {GET as read,PATCH as update,DELETE as remove} from '@/app/api/admin/jobs/[id]/route';
const mockAuth=jest.fn(),mockMembership=jest.fn(),mockProfile=jest.fn(),mockJob=jest.fn(),mockAuthFrom=jest.fn(),mockBusinessFrom=jest.fn(),mockService=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockAuth},from:mockAuthFrom})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockService()}));
jest.mock('@/lib/csrf',()=>({checkCsrf:()=>null}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:async()=>false}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('@/lib/audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
const id='11111111-1111-4111-8111-111111111111',user={id:'synthetic-owner'};
const routes=[['verify','PATCH',verify],['list','GET',list],['create','POST',create],['read','GET',read],['update','PATCH',update],['remove','DELETE',remove]] as const;
function request(method:string){return new NextRequest('https://carelink.invalid/api/admin/test',{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify({facility_id:id,is_verified:true,title:'Synthetic job',job_type:'ネイリスト',employment_type:'正社員'})})});}
function chain(finish:typeof mockMembership){const q={select:jest.fn(),eq:jest.fn(),in:jest.fn(),single:finish,maybeSingle:finish,then:(resolve:unknown,reject:unknown)=>finish().then(resolve,reject)};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.in.mockReturnValue(q);return q;}
beforeEach(()=>{
 jest.clearAllMocks();mockAuth.mockResolvedValue({data:{user},error:null});mockMembership.mockResolvedValue({data:[{facility_id:id,role:'owner'}],error:null});mockProfile.mockResolvedValue({data:{is_platform_admin:true},error:null});mockJob.mockResolvedValue({data:{id,facility_id:id},error:null});
 mockAuthFrom.mockImplementation(table=>{if(table==='profiles')return chain(mockProfile);if(table==='facility_members')return chain(mockMembership);throw new Error('unexpected auth table');});
 mockBusinessFrom.mockImplementation(table=>{if(table==='facility_jobs')return chain(mockJob);throw new Error('business mutation must not start');});mockService.mockReturnValue({from:mockBusinessFrom});
});
describe.each(routes)('%s',(_name,method,handler)=>{
 test.each(['data-error','null-error','throw'])('uncertain identity %s blocks all privileged access',async fault=>{
  if(fault==='throw')mockAuth.mockRejectedValue(new Error('private-auth-diagnostic'));else mockAuth.mockResolvedValue({data:{user:fault==='data-error'?user:null},error:{message:'private-auth-diagnostic'}});
  const response=await handler(request(method),{params:Promise.resolve({id})});expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({code:'AUTH_UNAVAILABLE'});expect(mockAuthFrom).not.toHaveBeenCalled();expect(mockService).not.toHaveBeenCalled();
 });
 test.each(['data-error','null-error','throw'])('uncertain access %s cannot read or mutate',async fault=>{
  const lookup=_name==='verify'?mockProfile:mockMembership;const data=_name==='verify'?{is_platform_admin:true}:[{facility_id:id,role:'owner'}];
  if(fault==='throw')lookup.mockRejectedValue(new Error('private-access-diagnostic'));else lookup.mockResolvedValue({data:fault==='data-error'?data:null,error:{code:'08006',message:'private-access-diagnostic'}});
  const response=await handler(request(method),{params:Promise.resolve({id})});expect(response.status).toBe(_name==='verify'?503:500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('private-access-diagnostic');expect(mockService).not.toHaveBeenCalled();
 });
});
describe.each(routes.slice(3))('%s read boundary',(_name,method,handler)=>{
 test.each(['data-error','null-error','throw'])('failed job lookup %s is not absence or permission to mutate',async fault=>{
  if(fault==='throw')mockJob.mockRejectedValue(new Error('private-job-diagnostic'));else mockJob.mockResolvedValue({data:fault==='data-error'?{id,facility_id:id}:null,error:{code:'08006',message:'private-job-diagnostic'}});
  const response=await handler(request(method),{params:Promise.resolve({id})});expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('private-job-diagnostic');expect(mockBusinessFrom).toHaveBeenCalledTimes(1);
 });
 test('genuine absence remains 404',async()=>{mockJob.mockResolvedValue({data:null,error:null});const response=await handler(request(method),{params:Promise.resolve({id})});expect(response.status).toBe(404);});
});
