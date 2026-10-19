import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_REGEX } from './constants';
import { createServiceRoleClient } from './supabase-server';
import { databaseDiagnostic } from './database-diagnostic';
import { serverError } from './with-route';
import type { Json } from '@/types/database.types';

export type PlatformControlKind = 'flag:create' | 'flag:update' | 'ticket:update' | 'facility:verify';
const flag = z.object({id:z.string().regex(UUID_REGEX),key:z.string(),enabled:z.boolean(),rollout_pct:z.number().int().min(0).max(100)}).passthrough();
const ticket = z.object({id:z.string().regex(UUID_REGEX),ticket_status:z.enum(['open','in_progress','waiting','resolved','closed']),priority:z.enum(['low','normal','high','urgent']),ticket_notes:z.string().nullable(),resolved_at:z.string().nullable()}).passthrough();
const facility = z.object({id:z.string().regex(UUID_REGEX),is_verified:z.boolean(),verified_type:z.enum(['phone','identity','site_visit']).nullable()}).passthrough();
export async function writePlatformControl(actor:string, record:string|null, kind:PlatformControlKind, values:Record<string, Json | undefined>, path:string) {
 const {data,error}=await createServiceRoleClient().rpc('manage_platform_control_atomic',{p_actor_id:actor,p_record_id:record,p_kind:kind,p_values:values});
 if(error?.code==='42501') return NextResponse.json({error:'Forbidden'},{status:403});
 if(error?.code==='P0002') return NextResponse.json({error:'Not found'},{status:404});
 if(error?.code==='22023') return NextResponse.json({error:'Invalid request'},{status:400});
 if(error?.code==='23505') return NextResponse.json({error:'Already exists'},{status:409});
 if(error) return serverError('platform-control-write',databaseDiagnostic(error),path);
 const parsed=(kind.startsWith('flag:')?flag:kind==='ticket:update'?ticket:facility).safeParse(data);
 if(!parsed.success || (record!==null && parsed.data.id.toLowerCase()!==record.toLowerCase())) return serverError('platform-control-receipt',new Error('PLATFORM_CONTROL_UNCONFIRMED'),path);
 const matches=Object.entries(values).every(([key,value])=>value===undefined || parsed.data[key]===value);
 if(!matches) return serverError('platform-control-receipt',new Error('PLATFORM_CONTROL_RESULT_MISMATCH'),path);
 return parsed.data;
}
export async function platformControlResponse(handler:()=>Promise<NextResponse>,path:string) {
 try {const response=await handler();response.headers.set('Cache-Control','no-store');return response;}
 catch(error) {const response=serverError('platform-control-dependency',databaseDiagnostic(error),path);response.headers.set('Cache-Control','no-store');return response;}
}
