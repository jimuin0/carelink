import { isDeepStrictEqual } from 'node:util';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_REGEX } from './constants';
import { createServiceRoleClient } from './supabase-server';
import { databaseDiagnostic } from './database-diagnostic';
import { serverError } from './with-route';
import type { Database, Json } from '@/types/database.types';
type Rows={feature:Database['public']['Tables']['feature_articles']['Row'];post:Database['public']['Tables']['platform_blog_posts']['Row'];newsletter:Database['public']['Tables']['newsletter_campaigns']['Row']};
type Actions={feature:'create'|'update'|'delete';post:'create'|'update'|'delete';newsletter:'create'|'cancel'};
const id=z.string().regex(UUID_REGEX);
const schemas={
 feature:z.object({id,title:z.string(),is_active:z.boolean()}).passthrough(),
 post:z.object({id,slug:z.string(),title:z.string(),is_published:z.boolean()}).passthrough(),
 newsletter:z.object({id,subject:z.string(),status:z.string(),created_by:id.nullable(),scheduled_at:z.string().nullable()}).passthrough(),
};
export async function writePlatformEditor<T extends keyof Rows>(actor:string,record:string|null,target:T,action:Actions[T],values:Record<string,Json|undefined>,path:string,expectedImage:string|null=null):Promise<Rows[T]|NextResponse>{
 const payload=JSON.parse(JSON.stringify(values)) as Json;
 const {data,error}=await createServiceRoleClient().rpc('manage_platform_editor_atomic',{p_actor_id:actor,p_record_id:record,p_kind:`${target}:${action}`,p_values:payload,p_expected_image_url:expectedImage});
 if(error?.code==='42501')return NextResponse.json({error:'Forbidden'},{status:403});
 if(error?.code==='P0002')return NextResponse.json({error:'Not found'},{status:404});
 if(error?.code==='22023')return NextResponse.json({error:'Invalid request'},{status:400});
 if(error?.code==='23505'||error?.code==='40001')return NextResponse.json({error:'状態が変更されています。再読み込みしてください'},{status:409});
 if(error)return serverError('platform-editor-write',databaseDiagnostic(error),path);
 const parsed=schemas[target].safeParse(data);
 if(!parsed.success||(record!==null&&parsed.data.id.toLowerCase()!==record.toLowerCase()))return serverError('platform-editor-receipt',new Error('PLATFORM_EDITOR_UNCONFIRMED'),path);
 if(!Object.entries(values).every(([key,value])=>value===undefined||isDeepStrictEqual(parsed.data[key],JSON.parse(JSON.stringify(value)))))return serverError('platform-editor-receipt',new Error('PLATFORM_EDITOR_VALUE_MISMATCH'),path);
 if(target==='newsletter'&&((action==='create'&&(parsed.data.status!=='draft'||parsed.data.created_by!==actor||parsed.data.scheduled_at!==null))||(action==='cancel'&&parsed.data.status!=='cancelled')))return serverError('platform-editor-receipt',new Error('PLATFORM_EDITOR_STATE_MISMATCH'),path);
 return parsed.data as Rows[T];
}
