import {NextResponse} from 'next/server';
import {createServiceRoleClient} from '@/lib/supabase-server';
import {checkCronAuth} from '@/lib/cron-auth';
import {cronError,logCronRun} from '@/lib/cron-logger';
import {queueScheduledEmail,reviewEmailCandidates,scheduledLegacyHolds} from '@/lib/scheduled-email-producer';

export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:Request) {
 const denied=checkCronAuth(request);if(denied) return denied;
 const startedAt=new Date();let queued=0,existing=0,skipped=0,deferred=0;
 try {
  const db=createServiceRoleClient();
  const legacyHeld=await scheduledLegacyHolds(db,'review_request');
  const batch=await reviewEmailCandidates(db);
  for(let i=0;i<batch.ids.length;i++) {
   if(Date.now()-startedAt.getTime()>50000) {deferred=batch.ids.length-i;break;}
   const result=await queueScheduledEmail(db,'review_request',batch.ids[i]);
   if(result==='queued') queued++;
   else if(result==='existing') existing++;
   else if(result==='accepted' || result==='skipped') skipped++;
   else return cronError('review-request',startedAt,new Error(`review operation ${result}`),{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0,deferred:batch.ids.length-i-1}});
  }
  if(legacyHeld>0) return cronError('review-request',startedAt,new Error('legacy review acceptance unconfirmed'),{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0,legacy_held:legacyHeld}});
  await logCronRun('review-request',queued?'success':'skipped',startedAt,{processed:queued,skipped,meta:{existing,deferred,more_available:batch.more,delivery:'worker_owned'}});
  return NextResponse.json({processed:queued,queued,existing,skipped,deferred,more_available:batch.more,sent:0});
 } catch(error) {return cronError('review-request',startedAt,error,{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0}});}
}
