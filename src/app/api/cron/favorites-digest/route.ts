import {NextResponse} from 'next/server';
import {createServiceRoleClient} from '@/lib/supabase-server';
import {checkCronAuth} from '@/lib/cron-auth';
import {cronError,logCronRun} from '@/lib/cron-logger';
import {digestEmailCandidates,queueScheduledEmail,scheduledLegacyHolds} from '@/lib/scheduled-email-producer';

export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request:Request) {
 const denied=checkCronAuth(request);if(denied) return denied;
 const startedAt=new Date();let queued=0,existing=0,skipped=0,deferred=0;
 try {
  const db=createServiceRoleClient();
  const legacyHeld=await scheduledLegacyHolds(db,'favorites_digest');
  const ids=await digestEmailCandidates(db);
  for(let i=0;i<ids.length;i++) {
   if(Date.now()-startedAt.getTime()>50000) {deferred=ids.length-i;break;}
   const identity=await db.auth.admin.getUserById(ids[i]);
   if(identity.error || !identity.data.user || identity.data.user.id!==ids[i]) throw new Error('Digest recipient identity unavailable');
   const user=identity.data.user;
   if(!user.email || !user.email_confirmed_at) {skipped++;continue;}
   const result=await queueScheduledEmail(db,'favorites_digest',ids[i],user.email);
   if(result==='queued') queued++;
   else if(result==='existing') existing++;
   else if(result==='accepted' || result==='skipped') skipped++;
   else return cronError('favorites-digest',startedAt,new Error(`digest operation ${result}`),{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0,deferred:ids.length-i-1}});
  }
  if(legacyHeld>0) return cronError('favorites-digest',startedAt,new Error('legacy digest acceptance unconfirmed'),{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0,legacy_held:legacyHeld}});
  await logCronRun('favorites-digest',queued?'success':'skipped',startedAt,{processed:queued,skipped,meta:{existing,deferred,delivery:'worker_owned'}});
  return NextResponse.json({processed:queued,queued,existing,skipped,deferred,sent:0});
 } catch(error) {return cronError('favorites-digest',startedAt,error,{extraLog:{processed:queued,skipped},extraBody:{queued,existing,sent:0}});}
}
