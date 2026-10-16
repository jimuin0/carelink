/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { runCalendarOperation } from '../calendar-sync-operation';
import { safeCaptureException } from '../safe';
import { alertCaughtError } from '../alert';
jest.mock('../safe',()=>({safeCaptureException:jest.fn()}));
jest.mock('../alert',()=>({alertCaughtError:jest.fn()}));
const ID='fc160004-0000-4000-8000-000000000001';
const ACTOR='fc160000-0000-4000-8000-000000000001';
const BOOKING='fc160002-0000-4000-8000-000000000001';
const TARGET='cl12345678901234567890123456789012';
const CALENDAR='synthetic@example.invalid';
function record(changes:Record<string,unknown>={}) {return {id:ID,actor_id:ACTOR,booking_id:BOOKING,kind:'sync',action:'create',state:'prepared',calendar_id:CALENDAR,google_event_id:TARGET,payload:{summary:'Synthetic'},...changes};}
const proof=(changes:Record<string,unknown>={})=>({id:TARGET,status:'confirmed',extendedProperties:{private:{carelinkOperation:ID}},...changes});
function setup(options:Record<string,unknown>={}) {
 const doc=record((options.doc??{}) as Record<string,unknown>);
 const credentials=jest.fn().mockResolvedValue({accessToken:'synthetic-access',tokenId:'fc160003-0000-4000-8000-000000000001',updatedAt:'2026-01-01T00:00:00Z'});
 const input={operationId:ID,userId:ACTOR,bookingId:BOOKING,kind:doc.kind as 'sync'|'delete',payload:{summary:'Input may differ on retry'},credentials};
 const responses:any={inspect_calendar_operation:options.inspect??{state:'absent',has_mapping:true},prepare_calendar_operation:doc,start_calendar_operation:{...doc,state:'started',dispatch:true},finish_calendar_operation:{...doc,state:'succeeded'}};
 const rpc=jest.fn(async(name:string)=>({data:responses[name],error:null}));
 const fetcher=jest.fn(async(url:unknown,init:any)=>{
  if(String(url).endsWith('/calendars/primary'))return Response.json({id:CALENDAR});
  if(init.method==='DELETE')return new Response(null,{status:204});
  return Response.json(proof());
 });global.fetch=fetcher as any;
 return {doc,input,responses,rpc,fetcher,credentials,run:()=>runCalendarOperation({rpc} as any,input)};
}
beforeEach(()=>jest.clearAllMocks());

test('create uses reserved ID and frozen payload, and finalizes only matching proof',async()=>{
 const s=setup();const res=await s.run();expect(res.status).toBe(200);expect(await res.json()).toEqual({ok:true,operationId:ID,googleEventId:TARGET});
 const write=s.fetcher.mock.calls.find(([,init])=>init.method==='POST')!;const payload=JSON.parse(write[1].body);
 expect(payload).toMatchObject({id:TARGET,summary:'Synthetic',extendedProperties:{private:{carelinkOperation:ID}}});expect(payload.summary).not.toContain('retry');
 expect(write[1].signal).toBeInstanceOf(AbortSignal);expect(res.headers.get('Cache-Control')).toBe('no-store');
 expect(s.rpc).toHaveBeenLastCalledWith('finish_calendar_operation',{p_id:ID,p_actor:ACTOR,p_event_id:TARGET});
});
test('update uses PUT at encoded concrete calendar and existing event ID',async()=>{
 const s=setup({doc:{action:'update'}});expect((await s.run()).status).toBe(200);const write=s.fetcher.mock.calls.find(([,init])=>init.method==='PUT')!;
 expect(String(write[0])).toContain('synthetic%40example.invalid/events/'+TARGET);expect(JSON.parse(write[1].body)).not.toHaveProperty('id');
});
test('completed receipt replays without credential or provider calls',async()=>{
 const s=setup({inspect:record({state:'succeeded'})});expect((await s.run()).status).toBe(200);expect(s.credentials).not.toHaveBeenCalled();expect(s.fetcher).not.toHaveBeenCalled();expect(s.rpc).toHaveBeenCalledTimes(1);
});
test('genuine absent deletion commits a no-op receipt without credentials',async()=>{
 const s=setup({doc:{kind:'delete',action:'noop',state:'succeeded',calendar_id:null,google_event_id:null},inspect:{state:'absent',has_mapping:false}});
 expect((await s.run()).status).toBe(200);expect(s.credentials).not.toHaveBeenCalled();expect(s.fetcher).not.toHaveBeenCalled();expect(s.rpc.mock.calls[1][0]).toBe('prepare_calendar_operation');
});
test.each(['prepared','started'])('pending %s uses receipt scope on retry',async(state)=>{
 const s=setup({inspect:record({state})});s.responses.start_calendar_operation.dispatch=false;
 expect((await s.run()).status).toBe(200);expect(s.fetcher.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
});
test('missing dispatch permission is read-only, not a second event write',async()=>{
 const s=setup();delete s.responses.start_calendar_operation.dispatch;expect((await s.run()).status).toBe(200);expect(s.fetcher.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
});
test.each(['prepare_calendar_operation','start_calendar_operation'])('a concurrent completion at %s replays the result',async stage=>{
 const s=setup();s.responses[stage]=record({state:'succeeded'});expect((await s.run()).status).toBe(200);expect(s.fetcher.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
});
test('an unexpectedly still-prepared start does not authorize any event request',async()=>{
 const s=setup();s.responses.start_calendar_operation=record();expect((await s.run()).status).toBe(503);expect(s.fetcher).toHaveBeenCalledTimes(1);
});
test('missing credentials after a retained receipt do not become unlinked success',async()=>{
 const s=setup();s.credentials.mockResolvedValue(null);expect((await s.run()).status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();
});
test.each([false,'primary','',null])('unverified primary response %j stops before preparing',async value=>{
 const s=setup();s.fetcher.mockResolvedValueOnce(value===false?new Response('{}',{status:403}):Response.json({id:value}));expect((await s.run()).status).toBe(503);expect(s.rpc).toHaveBeenCalledTimes(1);
});
test('malformed primary JSON is sanitized',async()=>{
 const s=setup();s.fetcher.mockResolvedValueOnce(new Response('private provider fragment'));expect((await s.run()).status).toBe(503);expect((safeCaptureException as jest.Mock).mock.calls[0][0].message).toBe('CALENDAR_OPERATION_UNCONFIRMED');
});
test.each(['inspect_calendar_operation','prepare_calendar_operation','start_calendar_operation','finish_calendar_operation'])('DB boundary at %s',async stage=>{
 for(const [state,status] of [['not_found',404],['conflict',409],['connection_changed',409]] as const) {
  const s=setup();s.responses[stage]={state};expect((await s.run()).status).toBe(status);
 }
});
test.each(['sync','delete'])('busy %s can only return a same-kind recovery ID',async kind=>{
 const s=setup({inspect:{state:'busy',id:ID,kind}});const res=await s.run();expect(res.status).toBe(409);const data=await res.json();expect(data.pendingOperationId).toBe(kind==='sync'?ID:undefined);expect(s.fetcher).not.toHaveBeenCalled();
});
test.each([null,{}, {state:'unknown'}, {state:'busy',id:'bad',kind:'sync'}, {state:'absent',has_mapping:'bad'}])('invalid receipt %j never becomes success',async inspect=>{
 const s=setup();s.responses.inspect_calendar_operation=inspect;
 if(inspect && inspect.state==='absent')s.input.kind='delete';
 expect((await s.run()).status).toBe(503);
});
test.each([
 {id:'fc160004-0000-4000-8000-000000000002'}, {actor_id:'fc160000-0000-4000-8000-000000000002'},
 {booking_id:'fc160002-0000-4000-8000-000000000002'}, {kind:'delete',action:'delete'},
 {calendar_id:null},{calendar_id:'primary'},{google_event_id:null},{action:'delete'},{action:'noop'},{kind:'sync',state:'started',action:'noop'},
])('unconfirmed/mismatched operation %j blocks provider events',async changes=>{
 const s=setup({inspect:record(changes)});expect((await s.run()).status).toBe(503);expect(s.fetcher).not.toHaveBeenCalled();
});
test('delete must never dispatch a create action',async()=>{
 const s=setup({doc:{kind:'delete',action:'create'}});expect((await s.run()).status).toBe(503);expect(s.fetcher).toHaveBeenCalledTimes(1);
});
test('non-completed noop is rejected',async()=>{
 const s=setup({doc:{kind:'delete',action:'noop'}});expect((await s.run()).status).toBe(503);
});
test('a prepared target differing from current primary stops before dispatch',async()=>{
 const s=setup({doc:{calendar_id:'different@example.invalid'}});expect((await s.run()).status).toBe(503);expect(s.rpc).toHaveBeenCalledTimes(2);
});
test.each(['error','data-error','throw'])('RPC %s is sanitized and blocks Google',async mode=>{
 const s=setup();const error={code:'08006',message:'private token input'};
 if(mode==='throw')s.rpc.mockRejectedValueOnce(error);else s.rpc.mockResolvedValueOnce({data:mode==='data-error'?record({state:'succeeded'}):null,error} as any);
 const res=await s.run();expect(res.status).toBe(503);expect(s.fetcher).not.toHaveBeenCalled();const diagnostic=(safeCaptureException as jest.Mock).mock.calls[0][0];expect(diagnostic.message).toBe(mode==='throw'?'CALENDAR_OPERATION_UNCONFIRMED':'DATABASE_FAILURE:08006');expect(diagnostic.stack).not.toContain('private token');expect(alertCaughtError).toHaveBeenCalledTimes(1);
});
test('unsettled DB operation cannot dispatch after the 5s verification deadline',async()=>{
 jest.useFakeTimers();try {const s=setup();let finish:any;s.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=s.run();await jest.advanceTimersByTimeAsync(5000);expect((await pending).status).toBe(503);finish({data:record({state:'succeeded'}),error:null});await Promise.resolve();expect(s.fetcher).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);}finally{jest.useRealTimers();}
});
test.each([{},proof({id:'other'}),proof({status:'cancelled'}),proof({extendedProperties:{private:{carelinkOperation:'other'}}})])('inconclusive create body %j does not finalize',async value=>{
 const s=setup();s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(Response.json(value));expect((await s.run()).status).toBe(503);expect(s.rpc.mock.calls.every(([name])=>name!=='finish_calendar_operation')).toBe(true);
});
test('a provider error is not success or a compensation DELETE',async()=>{
 const s=setup();s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(new Response('{}',{status:409}));expect((await s.run()).status).toBe(503);expect(s.fetcher.mock.calls.some(([,init])=>init.method==='DELETE')).toBe(false);
});
test('read-only recovery with 404 keeps unknown intent',async()=>{
 const s=setup();s.responses.start_calendar_operation.dispatch=false;s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(new Response('{}',{status:404}));expect((await s.run()).status).toBe(503);expect(s.rpc).toHaveBeenCalledTimes(3);
});
test.each([{}, {id:'other',status:'cancelled'},{id:TARGET,status:'confirmed'},{id:TARGET,status:'cancelled'}])('delete recovery evidence %j',async value=>{
 const s=setup({doc:{kind:'delete',action:'delete'}});s.responses.start_calendar_operation.dispatch=false;s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(Response.json(value));expect((await s.run()).status).toBe((value as any).id===TARGET&&(value as any).status==='cancelled'?200:503);expect(s.fetcher.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
});
test.each([204,403,410])('delete HTTP %s confirmation',async status=>{
 const s=setup({doc:{kind:'delete',action:'delete'}});s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(new Response(status===204?null:JSON.stringify({error:{errors:[{reason:'deleted'}]}}),{status}));expect((await s.run()).status).toBe(status===403?503:200);
});
test.each(['private fragment',JSON.stringify({}),JSON.stringify({error:{errors:[{reason:'fullSyncRequired'}]}})])('unconfirmed 410 %s preserves intent',async value=>{
 const s=setup({doc:{kind:'delete',action:'delete'}});s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockResolvedValueOnce(new Response(value,{status:410}));expect((await s.run()).status).toBe(503);
});
test('unconfirmed finalization is not acknowledged as saved',async()=>{
 const s=setup();s.responses.finish_calendar_operation=record({state:'started'});expect((await s.run()).status).toBe(503);
});
test('transport errors never expose credentials or repeat a mutation',async()=>{
 const s=setup();s.fetcher.mockResolvedValueOnce(Response.json({id:CALENDAR})).mockRejectedValueOnce(new Error('private access_token=synthetic-secret'));expect((await s.run()).status).toBe(503);expect(s.fetcher).toHaveBeenCalledTimes(2);const error=(safeCaptureException as jest.Mock).mock.calls[0][0];expect(error.message).toBe('CALENDAR_OPERATION_UNCONFIRMED');expect(error.stack).not.toContain('synthetic-secret');
});
