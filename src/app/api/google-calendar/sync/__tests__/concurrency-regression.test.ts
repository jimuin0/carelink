/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from '../route';
jest.mock('@/lib/csrf', () => ({ checkCsrf: () => null }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => false }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/auth-verification', () => ({ verifyAuthUser: async () => ({ state: 'verified', user: { id: '33333333-3333-4333-8333-333333333333' } }) }));
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: {} }) }));
const mockFrom = jest.fn();const mockRpc=jest.fn();
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom,rpc:mockRpc }) }));
const bookingId='11111111-1111-4111-8111-111111111111';
const actor='33333333-3333-4333-8333-333333333333';
const operationId='44444444-4444-4444-8444-444444444444';
function request() { return new NextRequest('http://localhost/api/google-calendar/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingId,operationId})}); }
function setup() {
 let mapping: unknown=null;const events=new Map<string,unknown>();let writes=0;let op:any;
 mockFrom.mockImplementation(table=>{
  const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='bookings'?{id:bookingId,user_id:actor,booking_date:'2026-12-01',start_time:'10:00:00',end_time:'11:00:00'}:{id:'55555555-5555-4555-8555-555555555555',access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:'2099-01-01',updated_at:'2026-10-16T00:00:00Z'},error:null})};return q;
 });
 mockRpc.mockImplementation(async(name,args)=>{
  if(name==='inspect_calendar_operation')return{data:op??{state:'absent',has_mapping:mapping!==null},error:null};
  if(name==='prepare_calendar_operation') {op??={id:args.p_id,actor_id:actor,booking_id:bookingId,kind:'sync',action:'create',state:'prepared',calendar_id:'synthetic@example.invalid',google_event_id:'cl'+operationId.replaceAll('-',''),payload:args.p_payload};return{data:op,error:null};}
  if(name==='start_calendar_operation'){const dispatch=op.state==='prepared';op.state='started';return{data:{...op,dispatch},error:null};}
  if(name==='finish_calendar_operation'){op.state='succeeded';mapping=op.google_event_id;return{data:op,error:null};}
  throw new Error('unexpected RPC');
 });
 const provider=jest.fn(async(url:unknown,options:any)=>{
  if(String(url).endsWith('/calendars/primary'))return Response.json({id:'synthetic@example.invalid'});
  if(options.method==='POST'){writes++;const body=JSON.parse(options.body);events.set(body.id,{...body,status:'confirmed'});return Response.json(events.get(body.id));}
  if(options.method==='GET'){const id=String(url).split('/').at(-1)!;return events.has(id)?Response.json(events.get(id)):new Response('{}',{status:404});}
  throw new Error('unexpected provider mutation');
 });global.fetch=provider as any;
 return {events,provider,get writes(){return writes}};
}
beforeEach(()=>jest.clearAllMocks());
test('parallel first sync creates only one external event',async()=>{
 const s=setup();const responses=await Promise.all([POST(request()),POST(request())]);expect(s.events.size).toBe(1);expect(responses.some(r=>r.status===200)).toBe(true);
});
test('a lost create response is recovered by reading the same event',async()=>{
 const s=setup();const normal=s.provider.getMockImplementation()!;let lose=true;s.provider.mockImplementation(async(...args)=>{const response=await normal(...args);if(lose && args[1].method==='POST'){lose=false;throw new Error('synthetic connection lost after commit')}return response});
 expect((await POST(request())).status).toBe(503);expect((await POST(request())).status).toBe(200);expect(s.writes).toBe(1);expect(s.events.size).toBe(1);
});
