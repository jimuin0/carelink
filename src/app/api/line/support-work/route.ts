import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCronAuth } from '@/lib/cron-auth';
import { serverError } from '@/lib/with-route';
import { lineSupportRpc } from '@/lib/line-support-store';
import { processLineSupportEvent } from '@/lib/line-support-processor';
import { dispatchLineSupportDelivery } from '@/lib/line-support-delivery';

export const dynamic='force-dynamic';
export const maxDuration=60;
const receipt=z.object({state:z.enum(['pending','processing','done','superseded']),rollout:z.enum(['off','observe','live']),delivery_id:z.uuid().nullable()}).nullable();
const reply=(retry:boolean)=>NextResponse.json({retry},{status:retry?503:200,headers:{'Cache-Control':'no-store'}});
/** Internal queue consumer, bearer authenticated; never called by a browser session. */
export async function POST(request:Request){
  const denied=checkCronAuth(request);if(denied)return denied;
  if(process.env.LINE_SUPPORT_ENABLED!=='true')return reply(true);
  const input=z.object({eventId:z.string().min(1).max(128)}).strict().safeParse(await request.json().catch(()=>null));
  if(!input.success)return NextResponse.json({error:'Invalid support job'},{status:400});
  try{
    const id=input.data.eventId;
    await processLineSupportEvent(id);
    const status=await lineSupportRpc('line_support_job_status',{p_event_id:id},receipt);
    if(!status)return reply(false);
    if(status.state==='pending'||status.state==='processing')return reply(true);
    if(status.state==='done'&&status.rollout==='live'&&status.delivery_id){
      const result=await dispatchLineSupportDelivery(status.delivery_id);
      // Missing credentials or another active claim cannot be called completed.
      if(result==='not_attempted'){
        const current=await lineSupportRpc('line_support_job_status',{p_event_id:id},receipt);
        return reply(Boolean(current&&(current.delivery_id||current.state==='pending'||current.state==='processing')));
      }
    }
    return reply(false);
  }catch{return serverError('line-support-worker',new Error('Durable support job awaits recovery'),'/api/line/support-work');}
}
