/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
let mockClient: () => unknown;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockClient() }));
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn(), alertWarning: jest.fn(), alertCaughtError: jest.fn() }));
import { GET } from '@/app/api/cron/review-request/route';
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
const originalFetch = globalThis.fetch;
let selected = '';
beforeAll(() => {
 process.env.CRON_SECRET='synthetic-local-cron-only';
 mockClient = () => ({
  from: db.from.bind(db),
  rpc: async (name: string, args?: Record<string, unknown>) => {
   const result = await db.rpc(name, args);
   if (name === 'list_scheduled_review_recipients' && Array.isArray(result.data)) return { ...result, data: result.data.filter((row: {id:string}) => row.id === selected) };
   return result;
  },
 });
 globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target=new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if(target.origin!==localApi.origin) throw new Error('External network refused');
  return originalFetch(input,init);
 }) as typeof fetch;
});
afterAll(() => {globalThis.fetch=originalFetch;delete process.env.CRON_SECRET;});
async function seedSynthetic() {
 const suffix=randomUUID();
 const facility=await db.from('facility_profiles').insert({name:'Synthetic review facility',slug:`synthetic-review-${suffix}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'published'}).select('id').single();
 if(facility.error || !facility.data)throw new Error('Synthetic facility insertion failed');
 const booking=await db.from('bookings').insert({facility_id:facility.data.id,booking_date:'2099-01-01',start_time:'10:00:00',end_time:'10:30:00',customer_name:'Synthetic',email:`review-${suffix}@example.invalid`,status:'completed',updated_at:new Date(Date.now()-2*24*60*60*1000).toISOString()}).select('id').single();
 if(booking.error || !booking.data)throw new Error(`Synthetic booking insertion failed: ${booking.error?.code ?? 'no-data'}`);selected=booking.data.id;return selected;
}
const cron=()=>GET(new Request('http://127.0.0.1/api/cron/review-request',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));
async function rows(id:string) {const r=await db.from('scheduled_email_operations').select('id,published_at,accepted_at').eq('kind','review_request').eq('source_id',id);if(r.error || !r.data)throw new Error('Synthetic operation lookup failed');return r.data;}
test('actual candidate and reservation RPCs enqueue one synthetic review email without delivery', async () => {
 const id=await seedSynthetic();const first=await cron();expect(first.status).toBe(200);expect(await first.json()).toMatchObject({queued:1,sent:0});const operations=await rows(id);expect(operations).toHaveLength(1);expect(operations[0].published_at).toBeTruthy();expect(operations[0].accepted_at).toBeNull();
 const q=await db.from('webhook_retry_queue').select('id,status').eq('id',operations[0].id).single();expect(q.error).toBeNull();expect(q.data).toMatchObject({status:'pending'});
 const repeat=await cron();expect(repeat.status).toBe(200);expect((await repeat.json()).queued).toBe(0);expect(await rows(id)).toHaveLength(1);
});
test('concurrent cron runs do not create duplicate synthetic review queue entries', async () => {
 const id=await seedSynthetic();const outcomes=await Promise.all([cron(),cron()]);expect(outcomes.every(r=>r.status===200)).toBe(true);const operations=await rows(id);expect(operations).toHaveLength(1);const queue=await db.from('webhook_retry_queue').select('id').eq('id',operations[0].id);expect(queue.error).toBeNull();expect(queue.data).toHaveLength(1);
});
