/** @jest-environment node */
import { NextRequest,NextResponse } from 'next/server';
import { POST,DELETE } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeCaptureException } from '@/lib/safe';
const mockFrom=jest.fn();const mockGetUser=jest.fn();const mockRun=jest.fn();const mockUpdate=jest.fn();
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:async()=>({auth:{getUser:mockGetUser}})}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>({from:mockFrom})}));
jest.mock('@/lib/calendar-sync-operation',()=>({runCalendarOperation:(...args:unknown[])=>mockRun(...args)}));
jest.mock('@/lib/csrf',()=>({checkCsrf:jest.fn(()=>null)}));
jest.mock('@/lib/rate-limit',()=>({checkRateLimit:jest.fn(async()=>false)}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));
jest.mock('@/lib/alert',()=>({alertCaughtError:jest.fn()}));
const USER='fc160000-0000-4000-8000-000000000001';const BOOK='fc160002-0000-4000-8000-000000000001';const OP='fc160004-0000-4000-8000-000000000001';const TOKEN='fc160003-0000-4000-8000-000000000001';
const booking={id:BOOK,user_id:USER,booking_date:'2030-01-07',start_time:'10:00:00',end_time:'11:00:00',facility_profiles:{name:'Synthetic',address:'Synthetic address'},menu:{name:'Synthetic menu'}};
const token={id:TOKEN,access_token:'synthetic-access',refresh_token:'synthetic-refresh',updated_at:'2026-01-01T00:00:00Z',expires_at:'2099-01-01'};
let found:any;let credential:any;let saved:any;
function req(method='POST',changes:Record<string,unknown>={}) {return method==='POST'?new NextRequest('http://localhost/api/google-calendar/sync',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingId:BOOK,operationId:OP,...changes})}):new NextRequest('http://localhost/api/google-calendar/sync?'+new URLSearchParams({bookingId:BOOK,operationId:OP,...changes} as Record<string,string>),{method});}
function chain(result:()=>unknown) {const q:any={select:jest.fn(()=>q),eq:jest.fn(()=>q),maybeSingle:jest.fn(async()=>result())};return q;}
beforeEach(()=>{
 jest.clearAllMocks();(checkCsrf as jest.Mock).mockReturnValue(null);(checkRateLimit as jest.Mock).mockResolvedValue(false);mockGetUser.mockResolvedValue({data:{user:{id:USER}},error:null});
 found={data:{...booking},error:null};credential={data:{...token},error:null};saved={data:{id:TOKEN,updated_at:'2026-10-16T00:00:00Z'},error:null,count:1};
 mockUpdate.mockImplementation(()=>chain(()=>saved));
 mockFrom.mockImplementation(table=>{const q=chain(()=>table==='bookings'?found:credential);q.update=mockUpdate;return q;});
 mockRun.mockImplementation(async(_admin,input)=>{try {const verified=await input.credentials();if(!verified)return NextResponse.json({error:'Google Calendar not connected'},{status:400});return NextResponse.json({ok:true,operationId:input.operationId,verified});}catch{return NextResponse.json({error:'Credential unavailable'},{status:503});}});
 global.fetch=jest.fn().mockResolvedValue(Response.json({access_token:'synthetic-refreshed',expires_in:3600}));
});
describe.each(['POST','DELETE'])('%s guards',(method)=>{
 const run=(changes:Record<string,unknown>={})=>method==='POST'?POST(req(method,changes)):DELETE(req(method,changes));
 test('CSRF failure stops before authentication',async()=>{(checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({error:'csrf'},{status:403}));expect((await run()).status).toBe(403);expect(mockGetUser).not.toHaveBeenCalled();});
 test('rate limit stops before authentication',async()=>{(checkRateLimit as jest.Mock).mockResolvedValue(true);expect((await run()).status).toBe(429);expect(mockGetUser).not.toHaveBeenCalled();});
 test('true unauthenticated is 401',async()=>{mockGetUser.mockResolvedValue({data:{user:null},error:null});expect((await run()).status).toBe(401);expect(mockFrom).not.toHaveBeenCalled();});
 test.each([{data:{user:null},error:{status:503,message:'private credentials'}},{data:{user:{id:USER}},error:{status:503,message:'private credentials'}},null])('unverified identity blocks DB/provider operations %j',async identity=>{mockGetUser.mockResolvedValue(identity);const res=await run();expect(res.status).toBe(503);expect(res.headers.get('Cache-Control')).toBe('no-store');expect(mockFrom).not.toHaveBeenCalled();expect(mockRun).not.toHaveBeenCalled();});
 test('identity SDK rejection is not absence',async()=>{mockGetUser.mockRejectedValue(new Error('private'));expect((await run()).status).toBe(503);expect(mockFrom).not.toHaveBeenCalled();});
 test('identity timeout stops operations',async()=>{jest.useFakeTimers();try{mockGetUser.mockImplementationOnce(()=>new Promise(()=>{}));const pending=run();await jest.advanceTimersByTimeAsync(5000);expect((await pending).status).toBe(503);expect(mockFrom).not.toHaveBeenCalled();}finally{jest.useRealTimers();}});
 test.each([{bookingId:''},{bookingId:'invalid'},{operationId:''},{operationId:'invalid'}])('invalid identifiers %j do not dispatch',async values=>{expect((await run(values)).status).toBe(400);expect(mockRun).not.toHaveBeenCalled();});
 test('unexpected helper failure has fixed diagnostics and no-store',async()=>{mockRun.mockRejectedValue(new Error('private access token'));const res=await run();expect(res.status).toBe(500);expect(res.headers.get('Cache-Control')).toBe('no-store');const diagnostic=(safeCaptureException as jest.Mock).mock.calls[0][0];expect(diagnostic.message).not.toContain('private');});
 test('non-RFC operation UUID never persists an intent',async()=>{expect((await run({operationId:'fc160004-0000-0000-0000-000000000001'})).status).toBe(400);expect(mockFrom).not.toHaveBeenCalled();});
 test('upper-case UUIDs use canonical DB scope',async()=>{expect((await run({bookingId:BOOK.toUpperCase(),operationId:OP.toUpperCase()})).status).toBe(200);expect(mockRun.mock.calls[0][1]).toMatchObject({bookingId:BOOK,operationId:OP});});
 test('verified scope and stable operation ID reach the common protocol',async()=>{expect((await run()).status).toBe(200);expect(mockRun.mock.calls[0][1]).toMatchObject({operationId:OP,userId:USER,bookingId:BOOK,kind:method==='POST'?'sync':'delete'});});
});
test.each([null,{},'invalid'])('POST malformed body %j is 400',async value=>{const r=new NextRequest('http://localhost/api/google-calendar/sync',{method:'POST',body:value==='invalid'?'{':JSON.stringify(value)});expect((await POST(r)).status).toBe(400);});
test('POST operation ID omission blocks cached old clients safely',async()=>{const r=new NextRequest('http://localhost/api/google-calendar/sync',{method:'POST',body:JSON.stringify({bookingId:BOOK})});expect((await POST(r)).status).toBe(400);expect(mockFrom).not.toHaveBeenCalled();});
test('POST non-string identifiers never get coerced',async()=>{expect((await POST(req('POST',{bookingId:123}))).status).toBe(400);expect((await POST(req('POST',{operationId:123}))).status).toBe(400);});
test('DELETE missing operation ID and missing booking are 400',async()=>{expect((await DELETE(new NextRequest('http://localhost/api/google-calendar/sync?bookingId='+BOOK,{method:'DELETE'}))).status).toBe(400);expect((await DELETE(new NextRequest('http://localhost/api/google-calendar/sync',{method:'DELETE'}))).status).toBe(400);});
test.each(['empty-error','data-error','throw'])('POST booking read %s stops before token read/operation',async mode=>{const error={code:'08006',message:'private SQL input'};found={data:mode==='data-error'?booking:null,error};if(mode==='throw')mockFrom.mockImplementationOnce(()=>{throw error});const res=await POST(req());expect(res.status).toBe(500);expect(mockRun).not.toHaveBeenCalled();expect(mockFrom).toHaveBeenCalledTimes(1);expect((safeCaptureException as jest.Mock).mock.calls[0][0].message).not.toContain('private');});
test('genuine missing booking remains 404',async()=>{found={data:null,error:null};expect((await POST(req())).status).toBe(404);expect(mockRun).not.toHaveBeenCalled();});
test.each(['error','data-error','throw'])('credential read %s cannot proceed',async mode=>{credential={data:mode==='data-error'?token:null,error:{message:'private token'}};if(mode==='throw')mockFrom.mockImplementation(table=>{if(table==='bookings')return chain(()=>found);throw new Error('private')});expect((await POST(req())).status).toBe(503);expect(global.fetch).not.toHaveBeenCalled();});
test('genuine no connection stays 400',async()=>{credential={data:null,error:null};expect((await POST(req())).status).toBe(400);});
test.each([{id:'bad'},{access_token:123},{access_token:''},{updated_at:'bad'}])('invalid credential snapshot %j blocks refresh/event writes',async changed=>{credential.data={...token,...changed};expect((await POST(req())).status).toBe(503);expect(global.fetch).not.toHaveBeenCalled();});
test.each([{expires_at:'bad',refresh_token:123},{expires_at:'2000-01-01',refresh_token:''},{expires_at:'2000-01-01',refresh_token:null}])('expired unrenewable credential %j remains unavailable',async changed=>{credential.data={...token,...changed};expect((await POST(req())).status).toBe(503);expect(global.fetch).not.toHaveBeenCalled();});
test('refresh uses the persisted authoritative DB revision and preserves refresh credential',async()=>{credential.data={...token,expires_at:'2000-01-01'};const r=await POST(req());expect(r.status).toBe(200);expect((await r.json()).verified).toEqual({accessToken:'synthetic-refreshed',tokenId:TOKEN,updatedAt:saved.data.updated_at});expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('refresh_token');expect(mockUpdate.mock.calls[0][1]).toEqual({count:'exact'});expect(mockUpdate.mock.results[0].value.eq.mock.calls).toEqual([['user_id',USER],['id',TOKEN],['updated_at',token.updated_at]]);expect(global.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token',expect.objectContaining({signal:expect.any(AbortSignal)}));});
test.each([{error:{message:'private'},data:null,count:null},{error:null,data:null,count:1},{error:null,data:{id:'different',updated_at:'2026-01-01'},count:1},{error:null,data:{id:TOKEN,updated_at:'bad'},count:1},...([0,null,undefined,2].map(count=>({error:null,data:{id:TOKEN,updated_at:'2026-01-01'},count})))])('unconfirmed refreshed save %j does not reach provider event handling',async result=>{credential.data={...token,expires_at:'2000-01-01'};saved=result;expect((await POST(req())).status).toBe(503);expect(global.fetch).toHaveBeenCalledTimes(1);});
test.each([{}, {access_token:'',expires_in:3600},{access_token:'valid',expires_in:0},{access_token:'valid',expires_in:1e100}])('invalid refresh payload %j remains unconfirmed',async body=>{credential.data={...token,expires_at:'2000-01-01'};(global.fetch as jest.Mock).mockResolvedValueOnce(Response.json(body));expect((await POST(req())).status).toBe(503);expect(mockUpdate).not.toHaveBeenCalled();});
test.each(['http-error','json-error','network-error','deadline'])('refresh %s stops credential persistence',async mode=>{
 credential.data={...token,expires_at:'2000-01-01'};
 if(mode==='http-error')(global.fetch as jest.Mock).mockResolvedValueOnce(new Response('{}',{status:403}));
 if(mode==='json-error')(global.fetch as jest.Mock).mockResolvedValueOnce(new Response('private credential fragment'));
 if(mode==='network-error')(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('private credential'));
 if(mode==='deadline')(global.fetch as jest.Mock).mockImplementationOnce(async()=>{const end=Date.now()+10001;jest.spyOn(Date,'now').mockReturnValue(end);return Response.json({access_token:'value',expires_in:3600});});
 try{expect((await POST(req())).status).toBe(503);expect(mockUpdate).not.toHaveBeenCalled();}finally{jest.restoreAllMocks();}
});
test.each([
 {facility_profiles:[{name:'Array facility',address:'Array address'}],menu:[{name:'Array menu'}]},
 {facility_profiles:[],menu:[]},{facility_profiles:null,menu:null},{facility_profiles:[{}],menu:[{}]},{facility_profiles:{},menu:{}},
])('event formatting retains existing fallback semantics %j',async fields=>{found.data={...booking,...fields};expect((await POST(req())).status).toBe(200);const event=mockRun.mock.calls[0][1].payload;expect(event.start).toEqual({dateTime:new Date(booking.booking_date+'T'+booking.start_time).toISOString(),timeZone:'Asia/Tokyo'});expect(event.end.dateTime).toBe(new Date(booking.booking_date+'T'+booking.end_time).toISOString());});
