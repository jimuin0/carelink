/** @jest-environment node */
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>null)}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockDb}));
jest.mock('@/lib/scheduled-email-producer',()=>({digestEmailCandidates:jest.fn(),queueScheduledEmail:jest.fn(),scheduledLegacyHolds:jest.fn(async()=>0)}));
jest.mock('@/lib/cron-logger',()=>({logCronRun:jest.fn(async()=>{}),cronError:jest.fn(async(_job,_date,_error,opts)=>new Response(JSON.stringify(opts?.extraBody),{status:500}))}));
const mockIdentity=jest.fn();const mockDb={auth:{admin:{getUserById:mockIdentity}}};
import {GET} from '../route';
import {checkCronAuth} from '@/lib/cron-auth';
import {digestEmailCandidates,queueScheduledEmail,scheduledLegacyHolds} from '@/lib/scheduled-email-producer';
import {logCronRun} from '@/lib/cron-logger';
const request=()=>new Request('https://localhost/api/cron/favorites-digest');
test('old weekly claims require reconciliation, never a second send',async()=>{
 (scheduledLegacyHolds as jest.Mock).mockResolvedValueOnce(1);const r=await GET(request());expect(r.status).toBe(500);expect((await r.json()).legacy_held).toBe(1);
});
beforeEach(()=>{jest.clearAllMocks();jest.restoreAllMocks();(checkCronAuth as jest.Mock).mockReturnValue(null);
 (digestEmailCandidates as jest.Mock).mockResolvedValue(['one']);(queueScheduledEmail as jest.Mock).mockResolvedValue('queued');
 mockIdentity.mockResolvedValue({data:{user:{id:'one',email:'auth@example.invalid',email_confirmed_at:'2026-10-13T00:00:00Z'}},error:null});});
test('unauthorized invocation never reads or publishes',async()=>{
 (checkCronAuth as jest.Mock).mockReturnValue(new Response('',{status:401}));expect((await GET(request())).status).toBe(401);expect(digestEmailCandidates).not.toHaveBeenCalled();
});
test('published source operation uses confirmed Auth recipient; queueing is not delivery',async()=>{
 const b=await (await GET(request())).json();expect(b).toEqual({processed:1,queued:1,existing:0,skipped:0,deferred:0,sent:0});
 expect(queueScheduledEmail).toHaveBeenCalledWith(mockDb,'favorites_digest','one','auth@example.invalid');
 expect(logCronRun).toHaveBeenCalledWith('favorites-digest','success',expect.any(Date),expect.objectContaining({processed:1}));
});
test('recipient/source later page error stops before publishing',async()=>{
 (digestEmailCandidates as jest.Mock).mockRejectedValue(new Error('second page failed'));expect((await GET(request())).status).toBe(500);expect(mockIdentity).not.toHaveBeenCalled();expect(queueScheduledEmail).not.toHaveBeenCalled();
});
test.each([{data:{user:null},error:null},{data:{user:{id:'other'}},error:null},{data:{user:{id:'one'}},error:{message:'lookup failed'}}])('Auth failure never becomes partial recipient success %#',async identity=>{
 mockIdentity.mockResolvedValue(identity);expect((await GET(request())).status).toBe(500);expect(queueScheduledEmail).not.toHaveBeenCalled();
});
test.each([{email:null,email_confirmed_at:'x'},{email:'auth@example.invalid',email_confirmed_at:null}])('missing/unverified destination is skipped %#',async patch=>{
 mockIdentity.mockResolvedValue({data:{user:{id:'one',...patch}},error:null});const b=await (await GET(request())).json();expect(b.skipped).toBe(1);expect(queueScheduledEmail).not.toHaveBeenCalled();
});
test.each(['existing','accepted','skipped'])('replayed/ineligible %s creates no second send',async result=>{
 (queueScheduledEmail as jest.Mock).mockResolvedValue(result);const b=await (await GET(request())).json();expect(b.queued).toBe(0);expect(b.sent).toBe(0);
});
test.each(['legacy_uncertain','uncertain','failed'])('unconfirmed %s remains an error without resetting the week',async result=>{
 (queueScheduledEmail as jest.Mock).mockResolvedValue(result);expect((await GET(request())).status).toBe(500);expect(queueScheduledEmail).toHaveBeenCalledTimes(1);
});
test('time budget preserves the remaining users',async()=>{
 (digestEmailCandidates as jest.Mock).mockResolvedValue(['one','two']);jest.spyOn(Date,'now').mockReturnValue(Date.now()+60000);
 const b=await (await GET(request())).json();expect(b.deferred).toBe(2);expect(mockIdentity).not.toHaveBeenCalled();
});
test('empty cohort is confirmed skipped',async()=>{
 (digestEmailCandidates as jest.Mock).mockResolvedValue([]);const b=await (await GET(request())).json();expect(b.sent).toBe(0);expect(b.queued).toBe(0);expect(logCronRun).toHaveBeenCalledWith('favorites-digest','skipped',expect.any(Date),expect.any(Object));
});
