/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
let mockClient: () => unknown;
const mockSend = jest.fn();
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
jest.mock('@supabase/supabase-js',()=>({...jest.requireActual('@supabase/supabase-js'),createClient:()=>mockClient()}));
jest.mock('@/lib/supabase-server',()=>({createServiceRoleClient:()=>mockClient()}));
jest.mock('@/lib/alert',()=>({alertWarning:jest.fn(),alertCaughtError:jest.fn(),alertDeliveryFailures:jest.fn()}));
import { GET } from '@/app/api/cron/birthday-coupon/route';
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
const db = jest.requireActual('@supabase/supabase-js').createClient(stack.env.API_URL, stack.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch=globalThis.fetch;
let selected='';
let holdScope='';
beforeAll(()=>{
 process.env.CRON_SECRET='synthetic-local-cron-only'; process.env.RESEND_API_KEY='synthetic-local-token';
 mockClient=()=>({from:(table:string)=>{const q=db.from(table);if(table==='profiles')return {select:(...args:unknown[])=>q.select(...args).eq('id',selected)};if(table==='birthday_notifications')return {select:(...args:unknown[])=>{const query=q.select(...args);return (args[1] as {head?:boolean}|undefined)?.head ? query.eq('user_id',holdScope) : query;},insert:(...args:unknown[])=>q.insert(...args),update:(...args:unknown[])=>q.update(...args),delete:(...args:unknown[])=>q.delete(...args)};return q;}});
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{const target=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(target.origin!==localApi.origin)throw new Error('External network refused');return originalFetch(input,init);}) as typeof fetch;
});
afterAll(()=>{globalThis.fetch=originalFetch;delete process.env.CRON_SECRET;delete process.env.RESEND_API_KEY;});
beforeEach(()=>{mockSend.mockReset().mockResolvedValue({data:{id:'synthetic-message'},error:null});});
async function seedSynthetic(unsubscribed = true){
 const suffix=randomUUID();const user=await db.auth.admin.createUser({email:`birthday-${suffix}@example.invalid`,password:`Local-${randomUUID()}Aa9!`,email_confirm:true});if(user.error||!user.data.user)throw new Error('Synthetic account creation failed');selected=user.data.user.id;holdScope=selected;
 const jst=new Date(Date.now()+9*3600000);const md=`${String(jst.getUTCMonth()+1).padStart(2,'0')}-${String(jst.getUTCDate()).padStart(2,'0')}`;
 const profile=await db.from('profiles').update({birth_date:`1992-${md}`,email_unsubscribed:unsubscribed}).eq('id',selected).select('id,birth_md').single();if(profile.error||profile.data?.birth_md!==md)throw new Error('Synthetic birthday profile setup failed');return selected;
}
const cron=()=>GET(new Request('http://127.0.0.1/api/cron/birthday-coupon',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));
async function points(id:string){const x=await db.from('user_points').select('points,reason').eq('user_id',id);if(x.error||!x.data)throw new Error('Synthetic points lookup failed');return x.data;}
test('synthetic birthday earns 100 points exactly once without email',async()=>{
 const id=await seedSynthetic();const first=await cron();expect(first.status).toBe(200);expect(await points(id)).toEqual([expect.objectContaining({points:100})]);const second=await cron();expect(second.status).toBe(200);expect(await points(id)).toHaveLength(1);
 const notifications=await db.from('birthday_notifications').select('user_id').eq('user_id',id);expect(notifications.error).toBeNull();expect(notifications.data).toHaveLength(0);
});
test('concurrent birthday runs cannot award synthetic points twice',async()=>{
 const id=await seedSynthetic();const responses=await Promise.all([cron(),cron()]);expect(responses.every(x=>x.status===200)).toBe(true);expect(await points(id)).toEqual([expect.objectContaining({points:100})]);
});

test('uncertain simulated provider response retains the DB claim and never sends twice',async()=>{
 const id=await seedSynthetic(false);mockSend.mockResolvedValueOnce({data:null,error:{statusCode:500}});const first=await cron();expect(first.status).toBe(500);
 const saved=await db.from('birthday_notifications').select('user_id,channel').eq('user_id',id);expect(saved.error).toBeNull();expect(saved.data).toEqual([{user_id:id,channel:'email'}]);
 const second=await cron();expect(second.status).toBe(200);expect(mockSend).toHaveBeenCalledTimes(1);expect(await points(id)).toHaveLength(1);
});
test('confirmed provider rejection releases the synthetic claim and can be retried explicitly',async()=>{
 const id=await seedSynthetic(false);mockSend.mockResolvedValueOnce({data:null,error:{statusCode:400}});const first=await cron();expect(first.status).toBe(500);const empty=await db.from('birthday_notifications').select('user_id').eq('user_id',id);expect(empty.error).toBeNull();expect(empty.data).toEqual([]);
 const retry=await cron();expect(retry.status).toBe(200);expect(mockSend).toHaveBeenCalledTimes(2);expect(await points(id)).toHaveLength(1);
});
test('stale uncertain synthetic claim remains visible even after the birthday day',async()=>{
 const id=await seedSynthetic(false);mockSend.mockResolvedValueOnce({data:null,error:{statusCode:500}});const first=await cron();expect(first.status).toBe(500);
 const state=await db.from('birthday_notifications').select('delivery_state').eq('user_id',id).single();expect(state.error).toBeNull();expect(state.data).toMatchObject({delivery_state:'pending'});
 const aged=await db.from('birthday_notifications').update({notified_at:new Date(Date.now()-20*60000).toISOString()}).eq('user_id',id);if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 selected='00000000-0000-0000-0000-000000000000';const nextDay=await cron();expect(nextDay.status).toBe(500);expect(await nextDay.json()).toMatchObject({pendingHolds:1});expect(mockSend).toHaveBeenCalledTimes(1);
 // The provider is a test stub: simulate an operator reconciling only this synthetic claim.
 const resolved=await db.from('birthday_notifications').update({delivery_state:'delivered'}).eq('user_id',id).eq('delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
 const after=await cron();expect(after.status).toBe(200);
});
