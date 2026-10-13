/** @jest-environment node */
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>null)}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockDb}));
jest.mock('@/lib/scheduled-email-producer',()=>({reviewEmailCandidates:jest.fn(),queueScheduledEmail:jest.fn(),scheduledLegacyHolds:jest.fn(async()=>0)}));
jest.mock('@/lib/cron-logger',()=>({logCronRun:jest.fn(async()=>{}),cronError:jest.fn(async(_job,_date,_error,opts)=>new Response(JSON.stringify(opts?.extraBody),{status:500}))}));
const mockDb={};
import {GET} from '../route';
import {checkCronAuth} from '@/lib/cron-auth';
import {reviewEmailCandidates,queueScheduledEmail,scheduledLegacyHolds} from '@/lib/scheduled-email-producer';
import {logCronRun,cronError} from '@/lib/cron-logger';
const request=()=>new Request('https://localhost/api/cron/review-request');
beforeEach(()=>{jest.clearAllMocks();jest.restoreAllMocks();(checkCronAuth as jest.Mock).mockReturnValue(null);
 (reviewEmailCandidates as jest.Mock).mockResolvedValue({ids:['one'],more:false});(queueScheduledEmail as jest.Mock).mockResolvedValue('queued');});
test('legacy claims remain visible as unconfirmed, never counted delivered',async()=>{
 (scheduledLegacyHolds as jest.Mock).mockResolvedValueOnce(2);const r=await GET(request());expect(r.status).toBe(500);expect((await r.json()).legacy_held).toBe(2);
});
test('unauthorized invocation never reads or publishes',async()=>{
 (checkCronAuth as jest.Mock).mockReturnValue(new Response('',{status:401}));expect((await GET(request())).status).toBe(401);expect(reviewEmailCandidates).not.toHaveBeenCalled();
});
test('complete candidate source is read before publishing; queued is NOT sent',async()=>{
 const response=await GET(request());expect(await response.json()).toEqual({processed:1,queued:1,existing:0,skipped:0,deferred:0,more_available:false,sent:0});
 expect(queueScheduledEmail).toHaveBeenCalledWith(mockDb,'review_request','one');expect(logCronRun).toHaveBeenCalledWith('review-request','success',expect.any(Date),expect.objectContaining({processed:1}));
});
test('source failure stops the run before creating any notification',async()=>{
 (reviewEmailCandidates as jest.Mock).mockRejectedValue(new Error('incomplete second page'));expect((await GET(request())).status).toBe(500);expect(queueScheduledEmail).not.toHaveBeenCalled();
});
test('no candidates is confirmed skipped, not sent',async()=>{
 (reviewEmailCandidates as jest.Mock).mockResolvedValue({ids:[],more:false});expect((await GET(request())).status).toBe(200);
 expect(logCronRun).toHaveBeenCalledWith('review-request','skipped',expect.any(Date),expect.objectContaining({processed:0}));
});
test.each(['existing','accepted','skipped'])('replayed or ineligible %s never counts another send',async result=>{
 (queueScheduledEmail as jest.Mock).mockResolvedValue(result);const r=await GET(request());const b=await r.json();expect(r.status).toBe(200);expect(b.queued).toBe(0);expect(b.sent).toBe(0);
});
test.each(['legacy_uncertain','uncertain','failed'])('unconfirmed %s is an error and does not reset a claim',async result=>{
 (queueScheduledEmail as jest.Mock).mockResolvedValue(result);expect((await GET(request())).status).toBe(500);expect(cronError).toHaveBeenCalled();expect(queueScheduledEmail).toHaveBeenCalledTimes(1);
});
test('time budget preserves unprepared candidates and reports truncation',async()=>{
 (reviewEmailCandidates as jest.Mock).mockResolvedValue({ids:['one','two'],more:true});jest.spyOn(Date,'now').mockReturnValue(Date.now()+60000);
 const b=await (await GET(request())).json();expect(b.deferred).toBe(2);expect(b.more_available).toBe(true);expect(queueScheduledEmail).not.toHaveBeenCalled();
});
