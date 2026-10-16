import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { safeCaptureException } from './safe';
import { databaseDiagnostic } from './database-diagnostic';
import { alertCaughtError } from './alert';
class CalendarDatabaseFailure extends Error {
  constructor(error: unknown) { super(databaseDiagnostic(error).message); }
}

const operationSchema = z.object({
  id: z.uuid(), actor_id: z.uuid(), booking_id: z.uuid(), kind: z.enum(['sync','delete']),
  action: z.enum(['create','update','delete','noop']), state: z.enum(['prepared','started','succeeded']),
  calendar_id: z.string().min(1).nullable(), google_event_id: z.string().min(1).nullable(),
  payload: z.record(z.string(),z.unknown()), dispatch: z.boolean().optional(),
});
type Operation = z.infer<typeof operationSchema>;
export interface CalendarCredentials { accessToken: string; tokenId: string; updatedAt: string }
interface Input {
  operationId: string; userId: string; bookingId: string; kind: 'sync'|'delete';
  payload: Record<string,unknown>; credentials: () => Promise<CalendarCredentials | null>;
}
function response(data: Record<string,unknown>, status = 200) {
  return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
}
function complete(op: Operation) {
  return response(op.kind==='sync' ? {ok:true,operationId:op.id,googleEventId:op.google_event_id} : {ok:true,operationId:op.id});
}
function unavailable(operationId: string) {
  return response({code:'CALENDAR_OUTCOME_UNCONFIRMED',operationId,error:'同期結果を確認できません。同じ操作で結果を再確認してください。'},503);
}
function boundary(doc: unknown, input: Input): NextResponse | null {
  const state=z.object({state:z.string()}).parse(doc).state;
  if(state==='not_found')return response({error:'Booking not found'},404);
  if(state==='conflict')return response({error:'操作を確認できません。',code:'CALENDAR_OPERATION_CONFLICT'},409);
  if(state==='connection_changed')return response({error:'カレンダー連携が変更されています。連携状態を再確認してください。',code:'CALENDAR_CONNECTION_CHANGED'},409);
  if(state==='busy') {
    const busy=z.object({id:z.uuid(),kind:z.enum(['sync','delete'])}).parse(doc);
    return response({error:'先の操作の結果を確認してください。',code:'CALENDAR_BUSY',...(busy.kind===input.kind?{pendingOperationId:busy.id}:{})},409);
  }
  return null;
}
function operation(doc: unknown, input: Input): Operation {
  const op=operationSchema.parse(doc);
  if(op.id!==input.operationId || op.actor_id!==input.userId || op.booking_id!==input.bookingId || op.kind!==input.kind)throw new Error('CALENDAR_OPERATION_SCOPE');
  if(op.action==='noop') {
    if(op.kind!=='delete'||op.state!=='succeeded')throw new Error('CALENDAR_OPERATION_NOOP');
  } else if(!op.calendar_id || op.calendar_id==='primary' || !op.google_event_id || (op.kind==='delete')!==(op.action==='delete'))throw new Error('CALENDAR_OPERATION_TARGET');
  return op;
}
async function rpc(admin: Pick<SupabaseClient,'rpc'>, name: string, args: Record<string,unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result=await Promise.race([
      Promise.resolve(admin.rpc(name,args)),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CALENDAR_DATABASE_TIMEOUT')),5000);}),
    ]);
    if(result.error) throw new CalendarDatabaseFailure(result.error);
    return result.data as unknown;
  } finally {clearTimeout(timer);}
}
async function google(url: string, accessToken: string, method='GET', body?: unknown) {
  return fetch(url,{method,headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
}
function activeProof(value: unknown, op: Operation) {
  const parsed=z.object({id:z.string(),status:z.enum(['confirmed','tentative','cancelled']),extendedProperties:z.object({private:z.record(z.string(),z.string())})}).safeParse(value);
  return parsed.success && parsed.data.id===op.google_event_id && parsed.data.status!=='cancelled' && parsed.data.extendedProperties.private.carelinkOperation===op.id;
}
function deletedProof(value: unknown, op: Operation) {
  const parsed=z.object({id:z.string(),status:z.literal('cancelled')}).safeParse(value);
  return parsed.success && parsed.data.id===op.google_event_id;
}
async function deletionConfirmed(res: Response) {
  if(res.status===204)return true;
  if(res.status!==410)return false;
  const parsed=z.object({error:z.object({errors:z.array(z.object({reason:z.string()}))})}).safeParse(await res.json().catch(()=>null));
  return parsed.success && parsed.data.error.errors.some(e=>e.reason==='deleted');
}

/** No lease expiry, automatic mutation retries or compensating DELETE. A started
 * intent survives uncertainty and is resolved only by provider evidence. */
export async function runCalendarOperation(admin: Pick<SupabaseClient,'rpc'>, input: Input): Promise<NextResponse> {
  try {
    const scope={p_id:input.operationId,p_actor:input.userId,p_booking:input.bookingId,p_kind:input.kind};
    const inspected=await rpc(admin,'inspect_calendar_operation',scope);
    const stop=boundary(inspected,input);if(stop)return stop;
    const state=z.object({state:z.string()}).parse(inspected).state;
    if(state!=='absent') {
      const prior=operation(inspected,input);if(prior.state==='succeeded')return complete(prior);
    }
    const absentDelete=state==='absent' && input.kind==='delete' && z.object({has_mapping:z.boolean()}).parse(inspected).has_mapping===false;
    let credentials: CalendarCredentials | null=null;let calendar: string | null=null;
    if(!absentDelete) {
      credentials=await input.credentials();
      if(!credentials)return response({error:'Google Calendar not connected'},400);
      const primary=await google('https://www.googleapis.com/calendar/v3/calendars/primary',credentials.accessToken);
      if(!primary.ok)return unavailable(input.operationId);
      calendar=z.object({id:z.string().min(1).max(1024)}).parse(await primary.json()).id;
      if(calendar==='primary')return unavailable(input.operationId);
    }
    const prepared=await rpc(admin,'prepare_calendar_operation',{...scope,p_payload:input.payload,p_calendar:calendar,p_token_id:credentials?.tokenId??null,p_token_updated_at:credentials?.updatedAt??null});
    const blocked=boundary(prepared,input);if(blocked)return blocked;
    let op=operation(prepared,input);if(op.state==='succeeded')return complete(op);
    if(!credentials || op.calendar_id!==calendar)return unavailable(input.operationId);
    const started=await rpc(admin,'start_calendar_operation',{p_id:op.id,p_actor:input.userId});
    const startBlocked=boundary(started,input);if(startBlocked)return startBlocked;
    op=operation(started,input);if(op.state==='succeeded')return complete(op);
    if(op.state!=='started')return unavailable(input.operationId);
    const url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(op.calendar_id!)}/events/${encodeURIComponent(op.google_event_id!)}`;
    let confirmed=false;
    if(op.dispatch===true) {
      if(op.action==='delete')confirmed=await deletionConfirmed(await google(url,credentials.accessToken,'DELETE'));
      else {
        const payload={...op.payload,...(op.action==='create'?{id:op.google_event_id}:{}),extendedProperties:{private:{carelinkOperation:op.id}}};
        const target=op.action==='create'?url.slice(0,url.lastIndexOf('/')):url;
        const res=await google(target,credentials.accessToken,op.action==='create'?'POST':'PUT',payload);
        confirmed=res.ok && activeProof(await res.json(),op);
      }
    } else {
      const res=await google(url,credentials.accessToken);
      if(res.ok) {const data:unknown=await res.json();confirmed=op.action==='delete'?deletedProof(data,op):activeProof(data,op);}
    }
    if(!confirmed)return unavailable(input.operationId);
    const finished=await rpc(admin,'finish_calendar_operation',{p_id:op.id,p_actor:input.userId,p_event_id:op.google_event_id});
    const finalBlocked=boundary(finished,input);if(finalBlocked)return finalBlocked;
    const saved=operation(finished,input);return saved.state==='succeeded'?complete(saved):unavailable(input.operationId);
  } catch(error) {
    const diagnostic=error instanceof CalendarDatabaseFailure?error:new Error('CALENDAR_OPERATION_UNCONFIRMED');
    safeCaptureException(diagnostic,'calendar-operation');
    alertCaughtError('calendar-operation',diagnostic,'/api/google-calendar/sync',503);
    return unavailable(input.operationId);
  }
}
