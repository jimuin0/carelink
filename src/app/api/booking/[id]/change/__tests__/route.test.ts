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

const body={booking_date:'2026-10-15',start_time:'12:00',end_time:'13:00'};
function request(input:unknown=body){return new Request(`http://localhost/api/booking/${ID}/change`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});}
beforeEach(()=>{
 jest.useFakeTimers({now:new Date('2026-10-14T00:00:00Z'),doNotFake:['setTimeout','clearTimeout']});
 jest.clearAllMocks();mockRotateCookies=false;mockSetCookie.mockReset();
 (checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockResolvedValue(false);
 (verifyAuthUser as jest.Mock).mockResolvedValue({state:'verified',user:{id:USER}});
 mockFrom.mockReturnValue(chain(booking));mockAdminFrom.mockReturnValue(chain(null));mockRpc.mockResolvedValue({data:[{id:ID,replayed:false}],error:null});
});
afterEach(()=>jest.useRealTimers());
test('change commits complete notifications with explicit owned actor and schedule gate',async()=>{
 const res=await POST(request(),props());expect(res.status).toBe(200);expect(await res.json()).toEqual({success:true});
 expect(mockRpc).toHaveBeenCalledWith('change_customer_booking_with_channels_atomic',{p_booking_id:ID,p_user_id:USER,p_booking_date:body.booking_date,p_start_time:body.start_time,p_end_time:body.end_time,p_enforce_schedule:true});
 expect(mockFrom).toHaveBeenCalledTimes(1);expect(mockAdminFrom).toHaveBeenCalledTimes(1);expect(mockAdminFrom).toHaveBeenCalledWith('facility_cancel_policies');expectNoInlineSend();
 expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({userId:USER,recordId:ID}));
});
test('replay never duplicates audit or provider attempt',async()=>{mockRpc.mockResolvedValue({data:[{id:ID,replayed:true}],error:null});expect((await POST(request(),props())).status).toBe(200);expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();});
test('response waits for booking plus complete intent commit',async()=>{
 let commit!:(value:unknown)=>void;mockRpc.mockReturnValue(new Promise(r=>{commit=r;}));let returned=false;
 const pending=POST(request(),props()).then(r=>{returned=true;return r;});await new Promise(r=>setTimeout(r,10));expect(returned).toBe(false);
 commit({data:[{id:ID,replayed:false}],error:null});expect((await pending).status).toBe(200);expectNoInlineSend();
});
test.each([['unauthenticated',401],['unavailable',503]])('auth %s stops mutation',async(state,status)=>{
 (verifyAuthUser as jest.Mock).mockResolvedValue({state});expect((await POST(request(),props())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();
});
test('DB read error is not a missing reservation',async()=>{mockFrom.mockReturnValue(chain(null,{code:'08006'}));expect((await POST(request(),props())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});
test.each([[null,404],[{...booking,user_id:'other'},403],[{...booking,status:'cancelled'},400],[{...booking,status:'completed'},400],[{...booking,status:'no_show'},400]])('source guard %#',async(data,status)=>{mockFrom.mockReturnValue(chain(data));expect((await POST(request(),props())).status).toBe(status);expect(mockRpc).not.toHaveBeenCalled();});
// Regression: the cancel route already refused a started booking, but a change was accepted and moved
// a reservation the customer never attended to another day.
test.each([
 ['one minute after the start (JST)', '2026-10-14T01:01:00Z'],
 ['later the same JST day, before UTC midnight', '2026-10-14T14:00:00Z'],
])('a booking whose start time has passed cannot be changed: %s',async(_label,now)=>{
 jest.setSystemTime(new Date(now));
 mockFrom.mockReturnValue(chain({...booking,booking_date:'2026-10-14',start_time:'10:00:00'}));
 const res=await POST(request({...body,booking_date:'2026-10-20'}),props());
 expect(res.status).toBe(409);
 expect((await res.json()).error).toBe('予約開始時刻を過ぎているため、オンラインでの日時変更はできません。施設へ直接ご連絡ください。');
 expect(mockRpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();
});
test('a booking that starts later today can still be changed',async()=>{
 jest.setSystemTime(new Date('2026-10-14T00:59:00Z'));
 mockFrom.mockReturnValue(chain({...booking,booking_date:'2026-10-14',start_time:'10:00:00'}));
 expect((await POST(request({...body,booking_date:'2026-10-20'}),props())).status).toBe(200);
 expect(mockRpc).toHaveBeenCalledWith('change_customer_booking_with_channels_atomic',expect.objectContaining({p_booking_id:ID}));
});
test('the database refusal for a started booking keeps the same 409 message',async()=>{
 mockRpc.mockResolvedValue({data:null,error:{message:'BOOKING_ALREADY_STARTED'}});
 const res=await POST(request(),props());
 expect(res.status).toBe(409);
 expect((await res.json()).error).toBe('予約開始時刻を過ぎているため、オンラインでの日時変更はできません。施設へ直接ご連絡ください。');
});
test('pending booking can change',async()=>{mockFrom.mockReturnValue(chain({...booking,status:'pending'}));expect((await POST(request(),props())).status).toBe(200);});
test.each([['BOOKING_NOT_READY',409],['BOOKING_CONFLICT',409],['BOOKING_CONFLICT: この時間帯は既に予約が入っています',409],['BOOKING_NOT_FOUND',404],['BOOKING_FORBIDDEN',403],['BOOKING_NOT_CHANGEABLE',400],['BOOKING_ALREADY_STARTED',409],['BOOKING_SLOT_PASSED: 選択した時間は過ぎています',409],['BOOKING_CHANGE_WINDOW_CLOSED: 無料キャンセルの期限を過ぎた予約は日時を変更できません',409],['BOOKING_CLOSED_DAY',409],['BOOKING_OUTSIDE_HOURS',409],['STAFF_NOT_WORKING',409],['SYNTHETIC_PLAN_FAILURE',500],[undefined,500]])('transaction error %s',async(message,status)=>{mockRpc.mockResolvedValue({data:null,error:{message}});expect((await POST(request(),props())).status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();});
test.each([null,[],[{id:ID,replayed:false},{id:ID,replayed:false}],[{id:'other',replayed:false}],[{id:ID,replayed:null}]])('invalid committed receipt %#',async data=>{mockRpc.mockResolvedValue({data,error:null});expect((await POST(request(),props())).status).toBe(500);expect(writeAuditLog).not.toHaveBeenCalled();});
test.each([
 {...body,booking_date:'bad'},{...body,booking_date:'2026-02-30'},{...body,booking_date:'2026-13-01'},{...body,booking_date:'2020-01-01'},{...body,booking_date:'2040-01-01'},
 {...body,start_time:'bad'},{...body,start_time:'25:00'},{...body,start_time:'12:60'},{...body,start_time:'12:00:60'},
 {...body,start_time:'13:00'},{...body,start_time:'14:00'},null,{}
])('invalid date or time never calls transaction %#',async input=>{expect((await POST(request(input),props())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
test('seconds returned by slot API remain valid',async()=>{expect((await POST(request({...body,start_time:'12:00:00',end_time:'13:00:00'}),props())).status).toBe(200);});
test('invalid JSON yields 400',async()=>{expect((await POST(new Request('http://localhost',{method:'POST',body:'{'}),props())).status).toBe(400);});
test('bad UUID stops before auth',async()=>{expect((await POST(request(),props('bad'))).status).toBe(400);expect(verifyAuthUser).not.toHaveBeenCalled();});
test('CSRF stops before rate limit',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('blocked',{status:403}));expect((await POST(request(),props())).status).toBe(403);expect(checkRateLimit).not.toHaveBeenCalled();});
test('rate limit stops before auth',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await POST(request(),props())).status).toBe(429);expect(verifyAuthUser).not.toHaveBeenCalled();});
test.each([false,true])('cookie rotation %s',async fail=>{mockRotateCookies=true;mockSetCookie.mockImplementation(()=>{if(fail)throw new Error('read only');});expect((await POST(request(),props())).status).toBe(200);});
test('exception stops mutation',async()=>{mockFrom.mockImplementation(()=>{throw new Error('synthetic');});expect((await POST(request(),props())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});

// Regression (2026-10-23): the new time of a change was never compared with the current time, so a customer could move
// a reservation to a time of today that had already passed (it then could not be changed or cancelled again). Nor was
// its length checked, so a hand-made request could shorten the reservation and free its second half for someone else.
const SLOT_PASSED='選択した時間はすでに過ぎています。日時を選び直してください。';
const LENGTH_MISMATCH='予約の所要時間と合わない時間は指定できません。表示されている時間から選び直してください。';
describe('the new time (2026-10-23)',()=>{
 // 2026-10-14 12:00 JST; the reservation itself is on 2026-10-15 10:00-11:00.
 beforeEach(()=>{jest.setSystemTime(new Date('2026-10-14T03:00:00Z'));});
 test.each([['11:30','12:30'],['12:00','13:00']])('a new start of %s today (now 12:00 JST) is refused before the transaction',async(start_time,end_time)=>{
  const res=await POST(request({booking_date:'2026-10-14',start_time,end_time}),props());
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe(SLOT_PASSED);
  expect(mockRpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();
 });
 test('a later start today is accepted',async()=>{
  expect((await POST(request({booking_date:'2026-10-14',start_time:'12:30',end_time:'13:30'}),props())).status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('change_customer_booking_with_channels_atomic',expect.objectContaining({p_booking_date:'2026-10-14',p_start_time:'12:30'}));
 });
 test.each([['shorter','12:00','12:30'],['longer','12:00','14:00']])('a %s time than the reservation is refused before the transaction',async(_label,start_time,end_time)=>{
  const res=await POST(request({...body,start_time,end_time}),props());
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe(LENGTH_MISMATCH);
  expect(mockRpc).not.toHaveBeenCalled();
 });
 test('the length is compared with the stored reservation (a 120-minute reservation moves as 120 minutes)',async()=>{
  mockFrom.mockReturnValue(chain({...booking,start_time:'10:00:00',end_time:'12:00:00'}));
  expect((await POST(request({...body,start_time:'12:00',end_time:'14:00'}),props())).status).toBe(200);
  expect((await POST(request(body),props())).status).toBe(400);
 });
 test('a reservation without a readable length moves as 60 minutes, as the change page offers',async()=>{
  mockFrom.mockReturnValue(chain({...booking,start_time:'10:00:00',end_time:'10:00:00'}));
  expect((await POST(request(body),props())).status).toBe(200);
 });
 test('the reservation read includes its end time',async()=>{
  const read=chain(booking);mockFrom.mockReturnValue(read);
  await POST(request(),props());
  expect(read.select).toHaveBeenCalledWith('id, user_id, status, facility_id, staff_id, booking_date, start_time, end_time');
 });
});

// Regression (2026-10-23, 神原さん option A): past the shop's free-cancellation deadline a customer could move the
// reservation days ahead and then cancel it for 0円 (the fee is computed from the new date/time), freeing the
// original slot at the last minute. The change is now refused with the same rule as the fee (isPastFreeCancelWindow).
const CHANGE_WINDOW_CLOSED='無料でキャンセルできる期限を過ぎた予約は、オンラインで日時を変更できません。日時の変更をご希望の場合は、店舗へ直接ご連絡ください。';
describe('the free-cancellation window (2026-10-23)',()=>{
 // Now 2026-10-14 09:00 JST; the reservation starts 2026-10-15 10:00 JST = 25 hours ahead.
 test.each([
  ['free_window, 26 hours',{cancel_rule:'free_window',free_cancel_hours:26,late_cancel_rate:50}],
  ['a row saved before cancel_rule existed',{cancel_rule:null,free_cancel_hours:26,late_cancel_rate:50}],
 ])('inside the window (%s) the change is refused before the transaction',async(_label,policy)=>{
  const policyChain=chain(policy);mockAdminFrom.mockReturnValue(policyChain);
  const res=await POST(request(),props());
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({error:CHANGE_WINDOW_CLOSED,code:'CHANGE_WINDOW_CLOSED'});
  expect(mockAdminFrom).toHaveBeenCalledWith('facility_cancel_policies');
  expect(policyChain.select).toHaveBeenCalledWith('free_cancel_hours, late_cancel_rate, cancel_rule');
  expect(policyChain.eq).toHaveBeenCalledWith('facility_id',FACILITY);
  expect(mockRpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();expectNoInlineSend();
 });
 test.each([
  ['before the deadline',{cancel_rule:'free_window',free_cancel_hours:24,late_cancel_rate:50}],
  ['期限なし (a fee applies anyway)',{cancel_rule:'always_fee',free_cancel_hours:26,late_cancel_rate:50}],
  ['ネットでのキャンセル不可',{cancel_rule:'no_online',free_cancel_hours:26,late_cancel_rate:50}],
  ['a 0% rate',{cancel_rule:'free_window',free_cancel_hours:26,late_cancel_rate:0}],
  ['no policy',null],
 ])('%s: the change goes ahead',async(_label,policy)=>{
  mockAdminFrom.mockReturnValue(chain(policy));
  expect((await POST(request(),props())).status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('change_customer_booking_with_channels_atomic',expect.objectContaining({p_booking_id:ID,p_enforce_schedule:true}));
 });
 test('a policy read error is not read as "no policy"',async()=>{
  mockAdminFrom.mockReturnValue(chain(null,{code:'08006'}));
  expect((await POST(request(),props())).status).toBe(500);
  expect(mockRpc).not.toHaveBeenCalled();expect(writeAuditLog).not.toHaveBeenCalled();
 });
 test('the database refusal maps to the same message and code',async()=>{
  mockRpc.mockResolvedValue({data:null,error:{message:'BOOKING_CHANGE_WINDOW_CLOSED: 無料キャンセルの期限を過ぎた予約は日時を変更できません'}});
  const res=await POST(request(),props());
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({error:CHANGE_WINDOW_CLOSED,code:'CHANGE_WINDOW_CLOSED'});
  expect(writeAuditLog).not.toHaveBeenCalled();
 });
});
