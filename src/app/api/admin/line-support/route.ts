import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute,authUnavailable,serverError,type RouteContext } from '@/lib/with-route';
import { lineSupportRpc,supportOperationSchema } from '@/lib/line-support-store';
import { supportCommandSchema,supportStoredListSchema,supportStoredDetailSchema } from '@/lib/line-support-contract';
import { lineSupportKnowledge } from '@/lib/line-support-knowledge';
import { lineSupportReadiness } from '@/lib/line-support-readiness';
import { processLineSupportPending } from '@/lib/line-support-processor';
import { writeAuditLog } from '@/lib/audit-logger';
import type { Json } from '@/types/database.types';

export const dynamic='force-dynamic';
export const maxDuration=60;
const path='/api/admin/line-support';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function authorize(ctx:RouteContext){
  const profile=await ctx.supabase!.from('profiles').select('is_platform_admin').eq('id',ctx.user!.id).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if(profile.error)return authUnavailable('line-support',path);
  return profile.data?.is_platform_admin===true?null:json({error:'運営アカウントでログインしてください。'},403);
}
function failure(error:unknown){
  const code=(error as {code?:string})?.code;
  if(code==='42501')return json({error:'操作権限を再確認してください。'},403);
  if(code==='PT409'||code==='23505')return json({error:'相談内容が変わりました。最新の内容を確認してください。'},409);
  if(code==='P0002')return json({error:'相談が見つかりません。'},404);
  if(code==='22023'||code==='22P02')return json({error:'入力内容と連携の有効期限を確認してください。'},400);
  return serverError('line-support-console',new Error('Support operation unavailable'),path);
}
export const GET=withRoute(async(request,ctx)=>{
  try{
    const denied=await authorize(ctx);if(denied)return denied;
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>key!=='id')||params.getAll('id').length>1)return json({error:'一覧の条件を確認してください。'},400);
    const id=params.get('id');if(id&&!z.uuid().safeParse(id).success)return json({error:'相談を選び直してください。'},400);
    if(id)return json({...await lineSupportRpc('read_line_support',{p_actor_id:ctx.user!.id,p_conversation_id:id},supportStoredDetailSchema),currentKnowledgeRevision:lineSupportKnowledge(process.env.VERCEL_GIT_COMMIT_SHA??null).revision});
    return json({...await lineSupportRpc('read_line_support',{p_actor_id:ctx.user!.id},supportStoredListSchema),readiness:lineSupportReadiness()});
  }catch(error){return failure(error);}
},{csrf:false,requireAuth:true});

export const POST=withRoute(async(request,ctx)=>{
  try{
    const denied=await authorize(ctx);if(denied)return denied;
    const command=supportCommandSchema.safeParse(await request.json().catch(()=>null));
    if(!command.success)return json({error:'操作内容を確認してください。'},400);
    const action=command.data.action;
    if(action==='rollout'&&command.data.mode==='live'&&!lineSupportReadiness().configured)
      return json({error:'開始に必要な設定が不足しています。設定を確認してから、もう一度お試しください。'},503);
    if(action==='recover')return json(await processLineSupportPending());
    let values:Json={};let code:string|undefined;
    if(action==='pair_start'){
      code=randomBytes(24).toString('base64url');values={hash:createHash('sha256').update(code).digest('hex')};
    }else if(action==='mode')values={conversationId:command.data.conversationId,revision:command.data.revision,mode:command.data.mode};
    else if(action==='rollout')values={mode:command.data.mode};
    const result=await lineSupportRpc('manage_line_support',{p_actor_id:ctx.user!.id,p_action:action,p_values:values},supportOperationSchema);
    // Neither the one-time code nor customer contents are included in the audit log.
    void writeAuditLog({action:'update',userId:ctx.user!.id,tableName:'line_support_settings',recordId:action==='mode'?command.data.conversationId:undefined,newValues:{operation:action}});
    return json({...result,...(code?{pairingText:`CareLink連携 ${code}`,expiresInSeconds:600}:{})});
  }catch(error){return failure(error);}
},{csrf:true,requireAuth:true,rateLimit:{limiter:null,limit:20,windowMs:60000,prefix:'line-support-console'}});
