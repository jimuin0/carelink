/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
let mockClient: () => unknown;
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockClient()}));
jest.mock('@/lib/alert',()=>({alertWarning:jest.fn(),alertCaughtError:jest.fn(),alertDeliveryFailures:jest.fn()}));
jest.mock('@/lib/email',()=>({sendDailySummaryEmail:jest.fn(),sendWeeklyReportEmail:jest.fn()}));
import { sendDailySummaryEmail, sendWeeklyReportEmail } from '@/lib/email';
let mockFailMark = false;
jest.mock('@/lib/cron-delivery-state', () => { const actual = jest.requireActual('@/lib/cron-delivery-state'); return { ...actual, markReportDeliveryAccepted: (...args: unknown[]) => mockFailMark ? Promise.resolve(false) : actual.markReportDeliveryAccepted(...args) }; });
import { GET as daily } from '@/app/api/cron/daily-summary/route';
import { GET as weekly } from '@/app/api/cron/weekly-report/route';
import { todayJst,addDays,previousJstWeek } from '@/lib/admin-date';
const statusFile = process.env.CARELINK_LOCAL_CRON_STACK_STATUS;
if (!statusFile) throw new Error('Dedicated stack status is required');
const saved = JSON.parse(readFileSync(statusFile, 'utf8'));
const root = realpathSync(saved.identity.project_root);
if (root !== '/private/tmp/carelink-cf-cron-check-20261029' || saved.runtime !== 'native') throw new Error('Unexpected local stack');
const stack = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
 cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' }, encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'],
}));
const localApi = new URL(stack.env.API_URL);
if (stack.identity.id !== saved.identity.id || stack.runtime !== 'native' || !['ready','sleeping'].includes(stack.readiness) || stack.env.API_URL !== saved.env.API_URL || localApi.protocol !== 'http:' || localApi.hostname !== '127.0.0.1' || !stack.env.SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) throw new Error('Isolated stack changed or delivery credentials are present');
const db = createClient(stack.env.API_URL, stack.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch=globalThis.fetch;
let selected='';
beforeAll(()=>{
 process.env.CRON_SECRET='synthetic-local-cron-only';
 mockClient=()=>({
  from:(table:string)=>{const q=db.from(table);if(table==='facility_notification_settings'||table==='daily_revenue_summary')return {select:(...args:unknown[])=>q.select(...args).eq('facility_id',selected)};if(table==='cron_report_sends')return {select:(...args:unknown[])=>q.select(...args).eq('facility_id',selected),insert:(...args:unknown[])=>q.insert(...args),update:(...args:unknown[])=>q.update(...args),delete:(...args:unknown[])=>q.delete(...args)};return q;},
  rpc:(name:string,args?:Record<string,unknown>)=>name==='aggregate_daily_revenue'?Promise.resolve({data:1,error:null}):db.rpc(name,args),
 });
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{const target=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(target.origin!==localApi.origin)throw new Error('External network refused');return originalFetch(input,init);}) as typeof fetch;
});
afterAll(()=>{globalThis.fetch=originalFetch;delete process.env.CRON_SECRET;});
beforeEach(()=>{mockFailMark=false;jest.clearAllMocks();(sendDailySummaryEmail as jest.Mock).mockImplementation(async data=>{data.onOutcome('uncertain');return false;});(sendWeeklyReportEmail as jest.Mock).mockImplementation(async data=>{data.onOutcome('uncertain');return false;});});
async function seedSynthetic(){
 const suffix=randomUUID();const auth=await db.auth.admin.createUser({email:`report-${suffix}@example.invalid`,password:`Local-${randomUUID()}Aa9!`,email_confirm:true});if(auth.error||!auth.data.user)throw new Error('Synthetic account creation failed');
 const facility=await db.from('facility_profiles').insert({name:'Synthetic report facility',slug:`synthetic-report-${suffix}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'published'}).select('id').single();if(facility.error||!facility.data)throw new Error('Synthetic facility creation failed');selected=facility.data.id;
 const member=await db.from('facility_members').insert({facility_id:selected,user_id:auth.data.user.id,role:'owner'});if(member.error)throw new Error(`Synthetic membership creation failed: ${member.error.code}`);
 const settings=await db.from('facility_notification_settings').insert({facility_id:selected,email_daily_summary:true,email_weekly_report:true});if(settings.error)throw new Error(`Synthetic settings creation failed: ${settings.error.code}`);
 const dates=[...new Set([addDays(todayJst(),-1),previousJstWeek(todayJst()).start])];const rows=dates.map(date=>({facility_id:selected,date,total_revenue:1234,booking_count:1,completed_count:1}));const summaries=await db.from('daily_revenue_summary').insert(rows);if(summaries.error)throw new Error(`Synthetic summary creation failed: ${summaries.error.code}`);return selected;
}
function request(name:string){return new Request(`http://127.0.0.1/api/cron/${name}`,{headers:{authorization:'Bearer synthetic-local-cron-only'}});}
async function claims(id:string,job:string){const x=await db.from('cron_report_sends').select('job').eq('facility_id',id).eq('job',job);if(x.error||!x.data)throw new Error('Synthetic report claim lookup failed');return x.data;}
test('daily report uncertain outcome keeps one real claim and is not resent',async()=>{
 const id=await seedSynthetic();const first=await daily(request('daily-summary'));expect(first.status).toBe(500);expect(await first.json()).toMatchObject({deliveryUncertain:1});expect(await claims(id,'daily-summary')).toHaveLength(1);const repeat=await daily(request('daily-summary'));expect(repeat.status).toBe(200);expect(sendDailySummaryEmail).toHaveBeenCalledTimes(1);
 const aged=await db.from('cron_report_sends').update({sent_at:new Date(Date.now()-20*60000).toISOString()}).eq('facility_id',id).eq('job','daily-summary');if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 const held=await daily(request('daily-summary'));expect(held.status).toBe(500);expect(await held.json()).toMatchObject({pendingHolds:1});expect(sendDailySummaryEmail).toHaveBeenCalledTimes(1);
 const resolved=await db.from('cron_report_sends').update({delivery_state:'delivered'}).eq('facility_id',id).eq('job','daily-summary').eq('delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
 const after=await daily(request('daily-summary'));expect(after.status).toBe(200);
});
test('weekly report uncertain outcome keeps one real claim and is not resent',async()=>{
 const id=await seedSynthetic();const first=await weekly(request('weekly-report'));expect(first.status).toBe(500);expect(await first.json()).toMatchObject({deliveryUncertain:1});expect(await claims(id,'weekly-report')).toHaveLength(1);const repeat=await weekly(request('weekly-report'));expect(repeat.status).toBe(200);expect(sendWeeklyReportEmail).toHaveBeenCalledTimes(1);
 const aged=await db.from('cron_report_sends').update({sent_at:new Date(Date.now()-20*60000).toISOString()}).eq('facility_id',id).eq('job','weekly-report');if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 const held=await weekly(request('weekly-report'));expect(held.status).toBe(500);expect(await held.json()).toMatchObject({pendingHolds:1});expect(sendWeeklyReportEmail).toHaveBeenCalledTimes(1);
 const resolved=await db.from('cron_report_sends').update({delivery_state:'delivered'}).eq('facility_id',id).eq('job','weekly-report').eq('delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
 const after=await weekly(request('weekly-report'));expect(after.status).toBe(200);
});
test.each([
 ['daily-summary',daily,sendDailySummaryEmail],
 ['weekly-report',weekly,sendWeeklyReportEmail],
])('%s explicit rejection releases the synthetic claim for retry',async(name,handler,send)=>{
 const id=await seedSynthetic();(send as jest.Mock).mockImplementationOnce(async data=>{data.onOutcome('rejected');return false;}).mockImplementationOnce(async data=>{data.onOutcome('delivered');return true;});
 const first=await handler(request(name as string));expect(first.status).toBe(500);expect(await first.json()).toMatchObject({deliveryUncertain:0});expect(await claims(id,name as string)).toHaveLength(0);
 const retry=await handler(request(name as string));expect(retry.status).toBe(200);expect(send).toHaveBeenCalledTimes(2);expect(await claims(id,name as string)).toHaveLength(1);
});

test.each([
 ['daily-summary',daily,sendDailySummaryEmail],
 ['weekly-report',weekly,sendWeeklyReportEmail],
])('%s lost acceptance acknowledgement leaves a monitored pending claim',async(name,handler,send)=>{
 const id=await seedSynthetic();(send as jest.Mock).mockImplementationOnce(async data=>{data.onOutcome('delivered');return true;});
 mockFailMark=true;
 const first=await handler(request(name as string));expect(first.status).toBe(500);expect(await first.json()).toMatchObject({deliveryUncertain:1});mockFailMark=false;
 const state=await db.from('cron_report_sends').select('delivery_state').eq('facility_id',id).eq('job',name).single();expect(state.error).toBeNull();expect(state.data).toMatchObject({delivery_state:'pending'});
 const aged=await db.from('cron_report_sends').update({sent_at:new Date(Date.now()-20*60000).toISOString()}).eq('facility_id',id).eq('job',name);if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 const held=await handler(request(name as string));expect(held.status).toBe(500);expect(await held.json()).toMatchObject({pendingHolds:1});expect(send).toHaveBeenCalledTimes(1);
 const resolved=await db.from('cron_report_sends').update({delivery_state:'delivered'}).eq('facility_id',id).eq('job',name).eq('delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
});
