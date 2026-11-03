/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
let mockClient: () => unknown;
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockClient()}));
jest.mock('@/lib/alert',()=>({alertWarning:jest.fn(),alertCaughtError:jest.fn()}));
jest.mock('@/lib/safe',()=>({safeCaptureException:jest.fn()}));
jest.mock('@/lib/email',()=>({sendBookingReminderForCron:jest.fn()}));
jest.mock('@/lib/line',()=>({sendBookingReminder:jest.fn()}));
// Only this test simulates the designated JST 09:00 run; the real time gate has separate tests.
jest.mock('@/lib/reminder-schedule',()=>({...jest.requireActual('@/lib/reminder-schedule'),isReminderSendHour:()=>true}));
import { sendBookingReminderForCron } from '@/lib/email';
import { GET } from '@/app/api/cron/booking-reminder/route';
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
  from:(table:string)=>{const q=db.from(table);if(table!=='sent_reminders')return q;return {
   select:(...args:unknown[])=>q.select(...args).eq('booking_id',selected),
   delete:(...args:unknown[])=>q.delete(...args).eq('booking_id',selected),
   update:(...args:unknown[])=>q.update(...args).eq('booking_id',selected),
   upsert:(...args:unknown[])=>q.upsert(...args),
  };},
  rpc:(name:string,args?:Record<string,unknown>)=>{const q=db.rpc(name,args);if(name!=='pending_booking_reminders')return q;return {select:(columns:string)=>q.select(columns).eq('id',selected)};},
 });
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{const target=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(target.origin!==localApi.origin)throw new Error('External network refused');return originalFetch(input,init);}) as typeof fetch;
});
afterAll(()=>{globalThis.fetch=originalFetch;delete process.env.CRON_SECRET;});
beforeEach(()=>{jest.clearAllMocks();(sendBookingReminderForCron as jest.Mock).mockResolvedValue('delivered');});
async function seedSynthetic(){
 const suffix=randomUUID();const facility=await db.from('facility_profiles').insert({name:'Synthetic reminder facility',slug:`synthetic-reminder-${suffix}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'published'}).select('id').single();if(facility.error||!facility.data)throw new Error('Synthetic facility insertion failed');
 const tomorrow=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10);
 const booking=await db.from('bookings').insert({facility_id:facility.data.id,booking_date:tomorrow,start_time:'10:00:00',end_time:'10:30:00',customer_name:'Synthetic',email:`reminder-${suffix}@example.invalid`,status:'confirmed'}).select('id').single();if(booking.error||!booking.data)throw new Error(`Synthetic booking insertion failed: ${booking.error?.code??'no-data'}`);selected=booking.data.id;return selected;
}
const cron=()=>GET(new Request('http://127.0.0.1/api/cron/booking-reminder',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));
async function reminders(id:string){const x=await db.from('sent_reminders').select('delivery_state').eq('booking_id',id);if(x.error||!x.data)throw new Error('Synthetic reminder lookup failed');return x.data;}
test('simulated email is recorded once for a synthetic next-day booking',async()=>{
 const id=await seedSynthetic();const first=await cron();expect(first.status).toBe(200);expect(await first.json()).toMatchObject({processed:1,planned:1});expect(await reminders(id)).toEqual([{delivery_state:'delivered'}]);const second=await cron();expect(second.status).toBe(200);expect(sendBookingReminderForCron).toHaveBeenCalledTimes(1);
});
test('uncertain delivery is retained and never retried automatically',async()=>{
 const id=await seedSynthetic();(sendBookingReminderForCron as jest.Mock).mockResolvedValue('uncertain');const first=await cron();expect(first.status).toBe(503);expect(await reminders(id)).toEqual([{delivery_state:'uncertain'}]);const second=await cron();expect(second.status).toBe(503);expect(sendBookingReminderForCron).toHaveBeenCalledTimes(1);
});
test('concurrent simulated reminder runs do not send twice',async()=>{
 const id=await seedSynthetic();const outcomes=await Promise.all([cron(),cron()]);expect(outcomes.every(r=>r.status===200)).toBe(true);expect(await reminders(id)).toEqual([{delivery_state:'delivered'}]);expect(sendBookingReminderForCron).toHaveBeenCalledTimes(1);
});
test('a confirmed non-delivery releases only its synthetic claim',async()=>{
 const id=await seedSynthetic();(sendBookingReminderForCron as jest.Mock).mockResolvedValue('failed');const first=await cron();expect(first.status).toBe(503);expect(await reminders(id)).toEqual([]);expect(sendBookingReminderForCron).toHaveBeenCalledTimes(1);
});
