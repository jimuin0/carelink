/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { POST as couponCreate } from '@/app/api/admin/chain/bulk-coupon/route';
import { POST as publicationChange } from '@/app/api/admin/chain/bulk-publish/route';
import { GET as reportRead } from '@/app/api/admin/report/route';
import { GET as accountingRead } from '@/app/api/admin/accounting-export/route';
const mockGetUser=jest.fn(),mockMembership=jest.fn(),mockFrom=jest.fn(),mockServiceClient=jest.fn(),mockRpc=jest.fn();
jest.mock('../supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockGetUser},from:mockFrom})}));
jest.mock('../supabase-server',()=>({createServiceRoleClient:()=>mockServiceClient()}));
jest.mock('../csrf',()=>({checkCsrf:()=>null}));
jest.mock('../rate-limit',()=>({checkRateLimit:async()=>false}));
jest.mock('../alert',()=>({alertCaughtError:jest.fn()}));
jest.mock('../audit-logger',()=>({writeAuditLog:jest.fn(),getRequestContext:()=>({})}));
const facilityId='11111111-1111-4111-8111-111111111111';
const routes=[['coupon','POST',couponCreate],['publication','POST',publicationChange],['report','GET',reportRead],['accounting','GET',accountingRead]] as const;
function request(method:string){return new NextRequest(`https://carelink.invalid/api/admin/test?facility_id=${facilityId}&from=2026-01-01&to=2026-01-31`,{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic',discount_type:'fixed',discount_value:100,facility_ids:[facilityId],is_published:false})})});}
beforeEach(()=>{
 jest.clearAllMocks();mockGetUser.mockResolvedValue({data:{user:{id:'synthetic-user'}},error:null});
 mockMembership.mockResolvedValue({data:[{facility_id:facilityId}],error:null});
 mockFrom.mockImplementation(table=>{
  if(table!=='facility_members')throw new Error('business query must not start');
  const chain={select:jest.fn(),eq:jest.fn(),in:jest.fn(),single:mockMembership,maybeSingle:mockMembership,then:(resolve:unknown,reject:unknown)=>mockMembership().then(resolve,reject)};
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.in.mockReturnValue(chain);return chain;
 });
 mockServiceClient.mockReturnValue({from:mockFrom,rpc:mockRpc});
});
describe.each(routes)('%s',(_name,method,handler)=>{
 test.each(['data-error','null-error','throw'])('uncertain auth %s blocks all business access',async fault=>{
  if(fault==='throw')mockGetUser.mockRejectedValue(new Error('private-auth-diagnostic'));
  else mockGetUser.mockResolvedValue({data:{user:fault==='data-error'?{id:'synthetic-user'}:null},error:{message:'private-auth-diagnostic'}});
  const response=await handler(request(method));expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({code:'AUTH_UNAVAILABLE'});expect(mockFrom).not.toHaveBeenCalled();expect(mockServiceClient).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
 });
 test.each(['data-error','null-error','throw'])('membership failure %s cannot issue coupons, publish or export data',async fault=>{
  if(_name==='coupon'){
   if(fault==='throw')mockRpc.mockRejectedValue(new Error('private-db-diagnostic'));
   else mockRpc.mockResolvedValue({data:fault==='data-error'?[{id:facilityId,facility_id:facilityId}]:null,error:{code:'08006',message:'private-db-diagnostic'}});
   const response=await handler(request(method));expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('private-db-diagnostic');expect(mockFrom).not.toHaveBeenCalled();expect(mockRpc).toHaveBeenCalledWith('create_chain_coupons_atomic',expect.objectContaining({p_facility_ids:[facilityId]}));return;
  }
  if(fault==='throw')mockMembership.mockRejectedValue(new Error('private-db-diagnostic'));
  else mockMembership.mockResolvedValue({data:fault==='data-error'?[{facility_id:facilityId,role:'owner'}]:null,error:{code:'08006',message:'private-db-diagnostic'}});
  const response=await handler(request(method));expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('private-db-diagnostic');expect(mockFrom).toHaveBeenCalledTimes(1);expect(mockFrom).toHaveBeenCalledWith('facility_members');expect(mockRpc).not.toHaveBeenCalled();
 });
});
