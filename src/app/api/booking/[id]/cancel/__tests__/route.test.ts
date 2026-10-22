/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({mutationRateLimit: {}, checkRateLimit: jest.fn(() => Promise.resolve(false))}));
jest.mock('@/lib/audit-logger', () => ({writeAuditLog: jest.fn()}));
jest.mock('@/lib/auth-verification', () => ({verifyAuthUser: jest.fn()}));
jest.mock('@/lib/with-route', () => ({
  serverError: jest.fn(() => new Response(JSON.stringify({error:'unavailable'}),{status:500})),
  authUnavailable: jest.fn(() => new Response(JSON.stringify({error:'auth unavailable'}),{status:503})),
}));
jest.mock('@/lib/push', () => ({sendPushToUser: jest.fn(), sendPushToFacilityOwners: jest.fn()}));
jest.mock('@/lib/line', () => ({sendBookingCancellation: jest.fn()}));
jest.mock('@/lib/integrations/line-works', () => ({sendLineWorksMessage: jest.fn(), notifyCancellationLineWorks: jest.fn()}));
jest.mock('@/lib/email', () => ({sendBookingCancelled: jest.fn(), sendBookingRescheduled: jest.fn()}));
const mockFrom=jest.fn();
const mockAdminFrom=jest.fn();
const mockRpc=jest.fn();
const mockSetCookie=jest.fn();
let mockRotateCookies=false;
jest.mock('next/headers',()=>({cookies:jest.fn(()=>({getAll:()=>[],set:mockSetCookie}))}));
jest.mock('@supabase/ssr',()=>({createServerClient:jest.fn((_url,_key,options)=>{
  options.cookies.getAll();
  if(mockRotateCookies) options.cookies.setAll([{name:'synthetic',value:'fixture',options:{path:'/'}}]);
  return {from:mockFrom,auth:{}};
})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:jest.fn(()=>({rpc:mockRpc,from:mockAdminFrom}))}));
import {POST} from '../route';
import {verifyAuthUser} from '@/lib/auth-verification';
import {checkCsrf} from '@/lib/csrf';
import {checkRateLimit} from '@/lib/rate-limit';
import {writeAuditLog} from '@/lib/audit-logger';
import {serverError} from '@/lib/with-route';
const ID='123e4567-e89b-12d3-a456-426614174000';
const USER='123e4567-e89b-12d3-a456-426614174001';
const FACILITY='123e4567-e89b-12d3-a456-426614174002';
const booking={id:ID,user_id:USER,facility_id:FACILITY,status:'confirmed',booking_date:'2026-10-15',start_time:'10:00:00',end_time:'11:00:00',staff_id:null};
function chain(data:unknown,error:unknown=null){const c={select:jest.fn(),eq:jest.fn(),maybeSingle:jest.fn().mockResolvedValue({data,error})};c.select.mockReturnValue(c);c.eq.mockReturnValue(c);return c;}
function props(id=ID){return {params:Promise.resolve({id})};}
function expectNoInlineSend(){for(const [module,names] of [
 ['@/lib/push',['sendPushToUser','sendPushToFacilityOwners']],
 ['@/lib/line',['sendBookingCancellation']],
 ['@/lib/integrations/line-works',['sendLineWorksMessage','notifyCancellationLineWorks']],
 ['@/lib/email',['sendBookingCancelled','sendBookingRescheduled']],
] as const){for(const name of names)expect(jest.requireMock(module)[name]).not.toHaveBeenCalled();}}

jest.mock('@/lib/liff-auth',()=>({getBearerToken:jest.fn(()=>null),resolveLiffUserId:jest.fn()}));
import {getBearerToken,resolveLiffUserId} from '@/lib/liff-auth';
const feeContext={policy:{free_cancel_hours:24,late_cancel_rate:50},totalPrice:5000,bookingDate:'2026-10-15',startTime:'10:00:00',capturedAt:'2026-10-14T15:00:00Z'};
function request(){return new Request(`http://localhost/api/booking/${ID}/cancel`,{method:'POST'});}
beforeEach(()=>{
 jest.clearAllMocks();mockRotateCookies=false;mockSetCookie.mockReset();
 (checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockResolvedValue(false);
 (verifyAuthUser as jest.Mock).mockResolvedValue({state:'verified',user:{id:USER}});
 (getBearerToken as jest.Mock).mockReturnValue(null);(resolveLiffUserId as jest.Mock).mockResolvedValue(USER);
 jest.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-14T15:00:00Z'));
 mockFrom.mockReturnValue(chain(booking));mockAdminFrom.mockReturnValue(chain(booking));
 mockRpc.mockResolvedValue({data:[{id:ID,fee_context:feeContext}],error:null});
});
afterEach(()=>jest.restoreAllMocks());
test('committed cancellation uses its fee receipt and never sends inline or rereads recipients',async()=>{
 const res=await POST(request(),props());expect(res.status).toBe(200);expect(await res.json()).toEqual({success:true,cancelFee:2500});
 expect(mockRpc).toHaveBeenCalledWith('cancel_customer_booking_with_channels_atomic',{p_actor_id:USER,p_booking_id:ID,p_expected_status:'confirmed'});
 expect(mockFrom).toHaveBeenCalledTimes(1);expect(mockAdminFrom).not.toHaveBeenCalled();expectNoInlineSend();
 expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:USER,facilityId:FACILITY,recordId:ID}));
});
test.each([null,{free_cancel_hours:24,late_cancel_rate:0}])('valid absent/free policy has zero fee %#',async policy=>{
 mockRpc.mockResolvedValue({data:[{id:ID,fee_context:{...feeContext,policy}}],error:null});
 expect(await (await POST(request(),props())).json()).toEqual({success:true,cancelFee:0});
});
test('response waits for the entire booking and intent commit',async()=>{
 let commit!:(value:unknown)=>void;mockRpc.mockReturnValue(new Promise(r=>{commit=r;}));let returned=false;
 const pending=POST(request(),props()).then(r=>{returned=true;return r;});
 await new Promise(r=>setTimeout(r,10));expect(returned).toBe(false);expectNoInlineSend();
 commit({data:[{id:ID,fee_context:feeContext}],error:null});expect((await pending).status).toBe(200);
});
test('LIFF resolves actor and uses service read, with no cookie authentication',async()=>{
 (getBearerToken as jest.Mock).mockReturnValue('synthetic-bearer');
 expect((await POST(request(),props())).status).toBe(200);expect(resolveLiffUserId).toHaveBeenCalledWith('synthetic-bearer');
 expect(verifyAuthUser).not.toHaveBeenCalled();expect(mockFrom).not.toHaveBeenCalled();expectNoInlineSend();
});
test('unverified LIFF stops before DB',async()=>{
 (getBearerToken as jest.Mock).mockReturnValue('synthetic-bearer');(resolveLiffUserId as jest.Mock).mockResolvedValue(null);
 expect((await POST(request(),props())).status).toBe(401);expect(mockAdminFrom).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});
test.each([['unauthenticated',401],['unavailable',503]])('auth %s stops mutation',async(state,status)=>{
 (verifyAuthUser as jest.Mock).mockResolvedValue({state});expect((await POST(request(),props())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();
});
test('booking read failure is 500 and keeps bounded diagnostic',async()=>{
 mockFrom.mockReturnValue(chain(null,{code:'08006',message:'private contact should not be logged'}));
 expect((await POST(request(),props())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();
 expect(serverError).toHaveBeenCalledWith('booking-cancel-read',expect.objectContaining({message:'DATABASE_FAILURE:08006'}),expect.any(String),expect.any(String));
});
test.each([[null,404],[{...booking,user_id:'someone-else'},403],[{...booking,status:'cancelled'},400],[{...booking,status:'completed'},400],[{...booking,status:'no_show'},400],[{...booking,booking_date:'2026-10-13'},400]])('source guard %#',async(data,status)=>{
 mockFrom.mockReturnValue(chain(data));expect((await POST(request(),props())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();
});
test('pending source can cancel',async()=>{mockFrom.mockReturnValue(chain({...booking,status:'pending'}));expect((await POST(request(),props())).status).toBe(200);});
test.each([['BOOKING_PERMISSION_DENIED',404],['BOOKING_REVISION_CONFLICT',409],['BOOKING_ALREADY_STARTED',400],['BOOKING_ONLINE_CANCEL_DISABLED',400],['SYNTHETIC_PLAN_FAILURE',500]])('transaction %s stops successful response',async(message,status)=>{
 mockRpc.mockResolvedValue({data:null,error:{message}});expect((await POST(request(),props())).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();
});
test.each([null,[],[{id:ID},{id:ID}],[{id:'different'}]])('invalid cancellation identity %#',async data=>{
 mockRpc.mockResolvedValue({data,error:null});expect([409,500]).toContain((await POST(request(),props())).status);expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([undefined,null,{}, {...feeContext,totalPrice:'5000'}, {...feeContext,bookingDate:'bad'}, {...feeContext,startTime:'25:00'}, {...feeContext,capturedAt:'bad'}, {...feeContext,policy:{free_cancel_hours:24}}])('unconfirmed fee context is never reported free %#',async context=>{
 mockRpc.mockResolvedValue({data:[{id:ID,fee_context:context}],error:null});expect((await POST(request(),props())).status).toBe(500);expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();
});
test('bad UUID stops before authentication',async()=>{expect((await POST(request(),props('bad'))).status).toBe(400);expect(verifyAuthUser).not.toHaveBeenCalled();});
test('CSRF guard stops before rate limit',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('blocked',{status:403}));expect((await POST(request(),props())).status).toBe(403);expect(checkRateLimit).not.toHaveBeenCalled();});
test('rate limit stops before authentication',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await POST(request(),props())).status).toBe(429);expect(verifyAuthUser).not.toHaveBeenCalled();});
test.each([false,true])('cookie rotation can be accepted or rejected by response owner %s',async fail=>{mockRotateCookies=true;mockSetCookie.mockImplementation(()=>{if(fail)throw new Error('read only');});expect((await POST(request(),props())).status).toBe(200);});
test('unexpected exception never turns into success',async()=>{mockFrom.mockImplementation(()=>{throw new Error('synthetic');});expect((await POST(request(),props())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});

// 店舗が「ネットでのキャンセル不可（店舗へ直接ご連絡）」を選んだときは、RPC がポリシーを見て断る。
test('online cancellation refused by the shop tells the customer to contact the shop',async()=>{
 mockRpc.mockResolvedValue({data:null,error:{message:'BOOKING_ONLINE_CANCEL_DISABLED'}});
 const res=await POST(request(),props());expect(res.status).toBe(400);
 expect(await res.json()).toEqual({error:'この店舗ではネットからのキャンセルをお受けしていません。キャンセルをご希望の場合は、店舗へ直接ご連絡ください。',code:'ONLINE_CANCEL_DISABLED'});
 expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();
});
// 回帰（D3/D13）: 旧「キャンセル不可」（free_cancel_hours=0）は予約画面で料金を案内しながら、応答は常に 0 円だった。
test.each([
 [{free_cancel_hours:0,late_cancel_rate:50},2500],
 [{free_cancel_hours:0,late_cancel_rate:50,cancel_rule:null},2500],
 [{free_cancel_hours:24,late_cancel_rate:30,cancel_rule:'always_fee'},1500],
 [{free_cancel_hours:24,late_cancel_rate:50,cancel_rule:'free_window'},0],
])('fee follows the shop rule even days before the start %#',async(policy,cancelFee)=>{
 mockRpc.mockResolvedValue({data:[{id:ID,fee_context:{...feeContext,policy,capturedAt:'2026-10-10T00:00:00Z'}}],error:null});
 expect(await (await POST(request(),props())).json()).toEqual({success:true,cancelFee});
});
test('an unknown rule in the fee context is not reported as free',async()=>{
 mockRpc.mockResolvedValue({data:[{id:ID,fee_context:{...feeContext,policy:{...feeContext.policy,cancel_rule:'never'}}}],error:null});
 expect((await POST(request(),props())).status).toBe(500);expect(writeAuditLog).not.toHaveBeenCalled();
});
