// Compatibility fixture for existing HTTP behavior assertions. The production
// gateway contract and real SQL races are tested independently; no business
// implementation is executed here.
import type { Json } from '@/types/database.types';
type Reply={data:Record<string,unknown>|Record<string,unknown>[]|null;error:unknown};
type Chain=PromiseLike<Reply>&{insert:(v:object)=>Chain;update:(v:object)=>Chain;delete:()=>Chain;eq:(k:string,v:unknown)=>Chain;select:()=>Chain;single:()=>Promise<Reply>;maybeSingle?:()=>Promise<Reply>};
export type EditorArgs={p_kind:string;p_record_id:string|null;p_actor_id:string;p_values:Record<string,Json|undefined>};
export async function legacyEditorRpc(from:(table:string)=>Chain,args:EditorArgs):Promise<Reply>{
 const [target,action]=args.p_kind.split(':');
 const table={feature:'feature_articles',post:'platform_blog_posts',newsletter:'newsletter_campaigns'}[target];
 if(!table)throw new Error('Unexpected fixture target');
 let chain=from(table);
 if(action==='create')chain=chain.insert(args.p_values);
 else if(action==='delete')chain=chain.delete().eq('id',args.p_record_id);
 else chain=chain.update(action==='cancel'?{status:'cancelled'}:args.p_values).eq('id',args.p_record_id);
 if(action==='cancel')chain=chain.eq('status','scheduled');
 chain=chain.select();
 const reply=action==='create'?await chain.single():action==='update'&&chain.maybeSingle?await chain.maybeSingle():await chain;
 if(reply.error)return {...reply,error:(reply.error as {code?:string}).code==='PGRST116'?{code:'P0002'}:reply.error};
 const row=Array.isArray(reply.data)?reply.data[0]:reply.data;
 if(!row)return {data:null,error:action==='create'?null:{code:action==='cancel'?'40001':'P0002'}};
 const defaults=target==='feature'?{title:'Fixture feature',is_active:true}:target==='post'?{slug:'fixture-post',title:'Fixture post',is_published:false}:{subject:'Fixture subject',status:action==='cancel'?'cancelled':'draft',created_by:args.p_actor_id,scheduled_at:null};
 const id=typeof row.id==='string'&&/^[0-9a-f-]{36}$/i.test(row.id)?row.id:args.p_record_id ?? '11111111-1111-1111-1111-111111111111';
 return {data:{...defaults,...row,...args.p_values,id},error:null};
}
